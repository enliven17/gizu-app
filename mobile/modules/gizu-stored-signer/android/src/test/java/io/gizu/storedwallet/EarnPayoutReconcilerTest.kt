package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnPayoutReconcilerTest {
  private val f = EarnPayoutFixtures
  private val blockHash = "0x" + "c".repeat(64)
  private val topic = "0x" + "d".repeat(64)

  private fun receipt() =
    JSONObject()
      .put("status", "0x1")
      .put("transactionHash", f.hash)
      .put("blockHash", blockHash)
      .put("blockNumber", "0xb")
      .put(
        "logs",
        JSONArray()
          .put(
            JSONObject()
              .put("address", ETH_EARN_USDC)
              .put(
                "topics",
                JSONArray()
                  .put(topic)
                  .put("0x" + "0".repeat(64))
                  .put("0x" + earnAddressWord(f.recipient)),
              )
              .put("data", "0x" + earnNumberWord("100"))
          ),
      )

  private fun rpc(row: JSONObject, changed: Boolean = false) =
    object : TransferRpc {
      var canonicalReads = 0

      override suspend fun call(method: String, params: JSONArray): Any =
        when (method) {
          "eth_chainId" -> "0x1"
          "eth_getTransactionReceipt" -> row
          "eth_getBlockByNumber" ->
            when (params.getString(0)) {
              "0xa" -> JSONObject().put("number", "0xa").put("hash", f.hash)
              "finalized" -> JSONObject().put("number", "0xc").put("hash", f.hash)
              "0xb" -> {
                canonicalReads++
                JSONObject()
                  .put("number", "0xb")
                  .put("hash", if (changed && canonicalReads > 1) f.hash else blockHash)
                  .put("timestamp", "0x3e8")
              }
              else -> error("Unexpected block")
            }
          else -> error("Unexpected $method")
        }
    }

  @Test
  fun authenticatedHistoryStillRequiresExactFinalCanonicalTokenTransfer() = runBlocking {
    val row =
      confirmNativePayoutReceipt(
        rpc(receipt()),
        f.prepared().getJSONObject("quote"),
        f.hash,
        "100",
      ) {
        topic
      }
    assertEquals(f.hash, row.getString("transactionHash"))
    assertEquals("100", row.getString("receivedAtoms"))
  }

  @Test
  fun wrongTokenRecipientAmountFailedReceiptAndReorgCannotProvePaid() = runBlocking {
    for (i in 0..4) {
      val r = receipt()
      val log = r.getJSONArray("logs").getJSONObject(0)
      when (i) {
        0 -> log.put("address", f.owner)
        1 -> log.getJSONArray("topics").put(2, "0x" + earnAddressWord(f.owner))
        2 -> log.put("data", "0x" + earnNumberWord("99"))
        3 -> r.put("status", "0x0")
      }
      try {
        confirmNativePayoutReceipt(
          rpc(r, i == 4),
          f.prepared().getJSONObject("quote"),
          f.hash,
          "100",
        ) {
          topic
        }
        fail("Rejected payout $i")
      } catch (_: IllegalStateException) {}
    }
  }

  @Test
  fun scanUsesPinnedTokenRecipientFinalizedBlocksAndRejectsAmbiguousTransfers() = runBlocking {
    var filter: JSONObject? = null
    var ambiguous = false
    val chain =
      object : TransferRpc {
        override suspend fun call(method: String, params: JSONArray): Any =
          when (method) {
            "eth_chainId" -> "0x1"
            "eth_getBlockByNumber" ->
              if (params.getString(0) == "finalized")
                JSONObject().put("number", "0xc").put("hash", f.hash)
              else JSONObject().put("number", "0xa").put("hash", f.hash)
            "eth_getLogs" -> {
              filter = params.getJSONObject(0)
              val log =
                receipt()
                  .getJSONArray("logs")
                  .getJSONObject(0)
                  .put("blockNumber", "0xb")
                  .put("transactionHash", f.hash)
              JSONArray().put(log).also {
                if (ambiguous)
                  it.put(JSONObject(log.toString()).put("transactionHash", f.nativeHash))
              }
            }
            else -> error("Unexpected $method")
          }
      }
    val scan = scanNativePayoutTransfers(chain, f.prepared().getJSONObject("quote"), "11") { topic }
    assertEquals(f.hash, scan.transactionHash)
    assertEquals("11", scan.nextBlock)
    assertEquals(ETH_EARN_USDC, filter!!.getString("address"))
    assertEquals("0xb", filter!!.getString("fromBlock"))
    assertEquals("0xc", filter!!.getString("toBlock"))
    assertEquals("0x" + earnAddressWord(f.recipient), filter!!.getJSONArray("topics").getString(2))
    ambiguous = true
    try {
      scanNativePayoutTransfers(chain, f.prepared().getJSONObject("quote"), "11") { topic }
      fail("Ambiguous destination")
    } catch (_: IllegalStateException) {}
  }
}
