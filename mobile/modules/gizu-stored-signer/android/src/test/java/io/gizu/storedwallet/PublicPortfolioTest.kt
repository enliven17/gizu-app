package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.*
import io.gizu.storedwallet.portfolio.toPublicMap
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.*

class PublicPortfolioTest {
  private fun canonical(value: Any?): Any? =
    when (value) {
      is JSONObject -> value.keys().asSequence().sorted().associateWith { canonical(value.get(it)) }
      is org.json.JSONArray -> (0 until value.length()).map { canonical(value.get(it)) }
      is Number -> value.toString()
      else -> value
    }

  @Test
  fun bothPlatformBindingsUseIdenticalFinancialFixtures() {
    val fixture = JSONObject(javaClass.getResource("/public-portfolio.json")!!.readText())
    val registry = fixture.getString("registry")
    val accounts = derivePortfolioAccounts(ByteArray(32), registry, 0u, 5u)
    val expectedAccounts = fixture.getJSONArray("accounts")
    assertEquals(listOf(0u, 1u, 3u, 4u, 5u), portfolioAccountIndices(registry))
    for ((i, account) in accounts.withIndex()) {
      assertEquals(expectedAccounts.getJSONObject(i).getString("address"), account.address)
    }
    val cases = fixture.getJSONArray("cases")
    for (i in 0 until cases.length()) {
      val case = cases.getJSONObject(i)
      val balances = case.getJSONArray("balances")
      val snapshot =
        buildPublicPortfolio(
          "portfolio-fixture",
          registry,
          accounts.mapIndexed { index, account ->
            val amount = if (balances.isNull(index)) null else balances.getString(index)
            if (amount != null) {
              assertEquals(
                amount,
                decodePortfolioBalance("0x" + amount.toBigInteger().toString(16).padStart(64, '0')),
              )
            }
            PortfolioObservation(account, amount)
          },
          PortfolioReadState(
            1790000000000uL,
            "0x123",
            case.getBoolean("complete"),
            case.getBoolean("stale"),
            case.getBoolean("syncPending"),
          ),
        )
      assertEquals(
        case.getString("name"),
        canonical(case.getJSONObject("expected")),
        canonical(JSONObject(snapshot.toPublicMap())),
      )
    }
  }

  @Test
  fun strictRpcDecodeKeepsCacheSemanticsAndNeverTreatsInvalidDataAsZero() = runBlocking {
    val file =
      object : WalletFile {
        var bytes: ByteArray? = null

        override fun exists() = bytes != null

        override fun read() = bytes!!.copyOf()

        override fun write(bytes: ByteArray) {
          this.bytes = bytes.copyOf()
        }
      }
    var valid = false
    val rpc =
      object : PortfolioRpc {
        override suspend fun call(method: String, params: JSONArray): Any =
          when (method) {
            "eth_chainId" -> "0x8f"
            "eth_getBlockByNumber" ->
              JSONObject().put("number", "0x123").put("hash", "0x" + "a".repeat(64))
            "eth_call" -> if (valid) "0x" + "7".padStart(64, '0') else "0x7"
            else -> error("Unexpected request")
          }
      }
    val key = javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val sync =
      TokenBalanceSync(
        file,
        { key },
        "fixture",
        143,
        "0x" + "1".repeat(40),
        rpc,
        ::decodePortfolioBalance,
      )
    val accounts = (1..81).map { "0x" + it.toString(16).padStart(40, '0') }
    try {
      sync.read(accounts, 0)
      fail("Malformed ABI accepted")
    } catch (_: IllegalStateException) {}
    assertFalse(file.exists())
    valid = true
    val partial = sync.read(accounts, 1)
    assertFalse(partial.complete)
    assertTrue(partial.stale && partial.syncPending)
    assertEquals(80, partial.balances.size)
    valid = false
    val stale = sync.read(accounts, 31_001)
    assertEquals(partial.balances, stale.balances)
    assertFalse(stale.complete)
    valid = true
    val completed = sync.read(accounts, 62_001)
    assertTrue(completed.complete)
    assertFalse(completed.stale || completed.syncPending)
    assertEquals(81, completed.balances.size)
  }
}
