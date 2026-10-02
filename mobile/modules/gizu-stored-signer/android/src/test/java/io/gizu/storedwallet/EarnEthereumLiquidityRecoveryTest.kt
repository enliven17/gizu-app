package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnEthereumLiquidityRecoveryTest {
  private val hash = "0x" + "a".repeat(64)
  private val owner = "0x" + "1".repeat(40)

  private fun journal(): EarnLiquidityJournal {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val file =
      object : WalletFile {
        var bytes: ByteArray? = null

        override fun exists() = bytes != null

        override fun read() = bytes!!.copyOf()

        override fun write(bytes: ByteArray) {
          this.bytes = bytes.copyOf()
        }
      }
    val j = EarnLiquidityJournal(file, { key }, "wallet", "generation")
    val p =
      JSONObject()
        .put("operationId", "fusion-1")
        .put("kind", "fusionEthOrder")
        .put("quoteId", hash)
        .put("expectedFrom", owner)
        .put("inputAtoms", "1000")
        .put("deadline", 200)
        .put("unsignedOrder", JSONObject().put("makerTraits", "0"))
    j.create(p)
    j.update("fusion-1", 1) {
      it
        .put("signedOrder", JSONObject().put("signature", "private-order"))
        .put("orderHash", hash)
        .put("signingProposal", p)
        .put("status", "unknown")
    }
    return j
  }

  @Test
  fun providerExpiredCannotReleaseOrderUntilCanonicalFinalizedDeadlineAndUnusedBit() = runBlocking {
    val j = journal()
    var timestamp = 150
    var invalidator = 0
    var canonical = hash
    var broadcasts = 0
    val gateway =
      NativeFusionGateway({ endpoint, _ ->
        check(endpoint == "status")
        JSONObject()
          .put("orderHash", hash)
          .put("status", "expired")
          .put("fills", JSONArray())
          .toString()
      })
    val rpc =
      object : TransferRpc {
        override suspend fun call(method: String, params: JSONArray): Any =
          when (method) {
            "eth_chainId" -> "0x1"
            "eth_getBlockByNumber" ->
              JSONObject()
                .put("hash", canonical)
                .put("number", "0x10")
                .put("timestamp", "0x" + timestamp.toString(16))
            "eth_call" -> {
              assertEquals(hash, params.getJSONObject(1).getString("blockHash"))
              "0x" + earnNumberWord(invalidator.toString())
            }
            "eth_sendRawTransaction" -> {
              broadcasts++
              error("Read-only reconciliation cannot send")
            }
            else -> error("Unexpected $method")
          }
      }
    reconcileEarnLiquidityOperations(j, rpc, gateway)
    assertEquals("signed", j.get("fusion-1").getString("status"))
    assertTrue(j.get("fusion-1").liquidityBlocked())
    timestamp = 201
    invalidator = 1
    reconcileEarnLiquidityOperations(j, rpc, gateway)
    assertEquals("unknown", j.get("fusion-1").getString("status"))
    assertTrue(j.get("fusion-1").liquidityBlocked())
    assertEquals(false, j.public(j.get("fusion-1"))["canResume"])
    invalidator = 0
    reconcileEarnLiquidityOperations(j, rpc, gateway)
    assertEquals("expired", j.get("fusion-1").getString("status"))
    assertFalse(j.get("fusion-1").liquidityBlocked())
    assertEquals(0, broadcasts)
  }
}
