package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnEthereumLiquidityReconcilerTest {
  private val owner = "0x" + "1".repeat(40)
  private val recipient = "0x" + "2".repeat(40)
  private val hash = "0x" + "a".repeat(64)
  private val topic = "0x" + "b".repeat(64)

  @Test
  fun legacyFullEthReturnMustMatchExactSenderRecipientValueNonceAndFixedGasPrice() {
    val p =
      JSONObject()
        .put("kind", "returnEth")
        .put("expectedFrom", owner)
        .put("recipient", recipient)
        .put("nonce", 4)
        .put("amountAtoms", "1000")
        .put("gasLimit", 21000)
        .put("maxFeePerGasWei", "10")
    val tx =
      JSONObject()
        .put("hash", hash)
        .put("from", owner)
        .put("to", recipient)
        .put("nonce", "0x4")
        .put("input", "0x")
        .put("value", "0x3e8")
        .put("gas", "0x5208")
        .put("type", "0x0")
        .put("gasPrice", "0xa")
    requireLiquidityTransaction(tx, p, hash)
    for ((field, value) in
      listOf(
        "value" to "0x3e7",
        "input" to "0x1234",
        "gasPrice" to "0x9",
        "type" to "0x2",
        "from" to recipient,
      )) {
      val changed = JSONObject(tx.toString()).put(field, value)
      assertThrows(IllegalStateException::class.java) {
        requireLiquidityTransaction(changed, p, hash)
      }
    }
  }

  @Test
  fun usdcReturnRequiresExactNativeRecipientTransferEvent() {
    val p =
      JSONObject()
        .put("kind", "returnUsdc")
        .put("expectedFrom", owner)
        .put("recipient", recipient)
        .put("amountAtoms", "1000")
    val event =
      JSONObject()
        .put("address", ETH_EARN_USDC)
        .put(
          "topics",
          JSONArray()
            .put(topic)
            .put("0x" + earnAddressWord(owner))
            .put("0x" + earnAddressWord(recipient)),
        )
        .put("data", "0x" + earnNumberWord("1000"))
    val receipt = JSONObject().put("logs", JSONArray().put(event))
    requireLiquidityReceipt(p, receipt) { topic }
    event.put("data", "0x" + earnNumberWord("999"))
    assertThrows(IllegalStateException::class.java) {
      requireLiquidityReceipt(p, receipt) { topic }
    }
  }

  @Test
  fun fusionFillRequiresExactProtectedOrderHashFullRemainingZeroAndInputOutflow() {
    val op =
      JSONObject()
        .put("orderHash", hash)
        .put("signingProposal", JSONObject().put("expectedFrom", owner).put("inputAtoms", "1000"))
    val fillTopic = "0x" + "c".repeat(64)
    val fill =
      JSONObject()
        .put("address", ETH_FUSION_ROUTER)
        .put("topics", JSONArray().put(fillTopic))
        .put("data", hash + earnNumberWord("0"))
    val transfer =
      JSONObject()
        .put("address", ETH_EARN_USDC)
        .put(
          "topics",
          JSONArray()
            .put(topic)
            .put("0x" + earnAddressWord(owner))
            .put("0x" + earnAddressWord(recipient)),
        )
        .put("data", "0x" + earnNumberWord("1000"))
    val receipt = JSONObject().put("logs", JSONArray().put(fill).put(transfer))
    val topics: (String) -> String = { if (it.startsWith("OrderFilled")) fillTopic else topic }
    requireFusionReceipt(op, receipt, topics)
    fill.put("data", hash + earnNumberWord("1"))
    assertThrows(IllegalStateException::class.java) { requireFusionReceipt(op, receipt, topics) }
    fill.put("data", hash + earnNumberWord("0"))
    transfer.put("data", "0x" + earnNumberWord("999"))
    assertThrows(IllegalStateException::class.java) { requireFusionReceipt(op, receipt, topics) }
  }
}
