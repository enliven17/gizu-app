package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.*
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TokenBalanceSyncTest {
  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private class Rpc : PortfolioRpc {
    var block = 100L
    var reads = 0
    var logReads = 0
    var dirty: String? = null
    var failure = false

    override suspend fun call(method: String, params: JSONArray): Any {
      check(!failure)
      return when (method) {
        "eth_chainId" -> "0x8f"
        "eth_getBlockByNumber" ->
          JSONObject()
            .put(
              "number",
              if (params.getString(0) == "finalized") "0x" + block.toString(16)
              else params.getString(0),
            )
            .put("hash", "0x" + "a".repeat(64))
        "eth_call" -> {
          reads++
          if (params.getJSONObject(0).getString("data").endsWith("1")) "0x6acfc0" else "0x0"
        }
        "eth_getLogs" -> {
          logReads++
          JSONArray().also { result ->
            dirty?.let { address ->
              result.put(
                JSONObject()
                  .put("address", TOKEN)
                  .put("removed", false)
                  .put("blockNumber", "0x" + block.toString(16))
                  .put(
                    "topics",
                    JSONArray()
                      .put(TRANSFER)
                      .put("0x" + "0".repeat(64))
                      .put("0x" + address.removePrefix("0x").padStart(64, '0')),
                  )
              )
            }
          }
        }
        else -> error(method)
      }
    }
  }

  @Test
  fun unchangedOpeningDoesNotReadEveryBalanceAndExternalDepositRefreshesEmptyAccount() =
    runBlocking {
      val rpc = Rpc()
      val file = File()
      val key = javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
      val addresses = (1..20).map { "0x" + it.toString(16).padStart(40, '0') }
      val sync = TokenBalanceSync(file, { key }, "wallet", 143, TOKEN, rpc)
      val initial = sync.read(addresses, 0)
      assertTrue(initial.complete)
      assertEquals(20, rpc.reads)
      rpc.block = 101
      sync.read(addresses, 31_000)
      assertEquals(20, rpc.reads)
      assertTrue(rpc.logReads > 0)
      rpc.block = 102
      rpc.dirty = addresses.last()
      sync.read(addresses, 62_000)
      assertEquals(21, rpc.reads)
      rpc.failure = true
      val stale = sync.read(addresses, 93_000)
      assertTrue(stale.stale)
      assertEquals(initial.balances[addresses.first()], stale.balances[addresses.first()])
    }

  @Test
  fun growingCatalogueReadsOnlyNewAddressesAndSnapshotSurvivesRestart() = runBlocking {
    val rpc = Rpc()
    val file = File()
    val key = javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val a = "0x" + "0".repeat(39) + "1"
    val b = "0x" + "0".repeat(39) + "2"
    TokenBalanceSync(file, { key }, "wallet", 143, TOKEN, rpc).read(listOf(a), 0)
    TokenBalanceSync(file, { key }, "wallet", 143, TOKEN, rpc).read(listOf(a, b), 1)
    assertEquals(2, rpc.reads)
  }

  companion object {
    const val TOKEN = "0x754704bc059f8c67012fed69bc8a327a5aafb603"
    const val TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  }
}
