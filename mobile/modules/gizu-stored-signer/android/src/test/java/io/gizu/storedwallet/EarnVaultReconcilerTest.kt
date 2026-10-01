package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnVaultReconcilerTest {
  private val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val owner = "0x" + "1".repeat(40)
  private val hash = "0x" + "a".repeat(64)
  private val block = "0x" + "b".repeat(64)
  private val topic = "0x" + "c".repeat(64)
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private fun operation(
    kind: String = "vaultDeposit",
    amount: String = "1000000",
  ): EarnVaultJournal {
    val j = EarnVaultJournal(File(), { key }, wallet, wallet)
    j.create(
      JSONObject()
        .put("operationId", "deposit-1")
        .put("revision", 1)
        .put("kind", kind)
        .put("expectedFrom", owner)
        .put("amountAtoms", amount)
    )
    j.prepare(
      "deposit-1",
      1,
      JSONArray()
        .put(
          JSONObject()
            .put("to", ETH_EARN_ROUTER)
            .put("data", "0x6bbba4e0")
            .put("nonce", "4")
            .put("valueWei", "0")
            .put("gasLimit", "300000")
            .put("maxFeePerGasWei", "10")
            .put("priorityFeePerGasWei", "1")
        ),
      "review",
      "review",
    )
    j.update("deposit-1", 2) { it.put("baselineShares", "10") }
    j.persistSigned("deposit-1", 3, 0, "0x02abcdef", hash, owner, "4", "review")
    return j
  }

  private inner class Rpc : TransferRpc {
    var receipt: Any = JSONObject.NULL
    var tx: Any = JSONObject.NULL
    var latest = "0x4"
    var canonical = block
    var sent = 0
    var observedShares = "20"

    override suspend fun call(method: String, params: JSONArray): Any =
      when (method) {
        "eth_chainId" -> "0x1"
        "eth_getTransactionReceipt" -> receipt
        "eth_getTransactionByHash" -> tx
        "eth_getTransactionCount" -> latest
        "eth_getBlockByNumber" -> JSONObject().put("hash", canonical).put("number", "0x20")
        "eth_call" -> "0x" + earnNumberWord(observedShares)
        "eth_sendRawTransaction" -> {
          sent++
          error("Refresh must not send")
        }
        else -> error("Unexpected $method")
      }
  }

  @Test
  fun absentReceiptRetainsNonceLockAndNeverAutomaticallySends() = runBlocking {
    val j = operation()
    val rpc = Rpc()
    reconcileEarnVaultOperations(j, rpc, { topic })
    assertTrue(j.public(j.get("deposit-1"))["canResume"] as Boolean)
    assertTrue(j.get("deposit-1").earnBlocked())
    assertEquals(0, rpc.sent)
    rpc.latest = "0x5"
    reconcileEarnVaultOperations(j, rpc, { topic })
    assertFalse(j.public(j.get("deposit-1"))["canResume"] as Boolean)
    assertTrue(j.get("deposit-1").earnBlocked())
  }

  @Test
  fun fullWithdrawalRequiresOwnerShareBurnAndExactRouterUsdcPayout() {
    val zero = "0x" + "0".repeat(40)
    val withdrawTopic = "0x" + "d".repeat(64)
    val transferTopic = "0x" + "e".repeat(64)
    val topics: (String) -> String = {
      if (it.startsWith("Withdraw(")) withdrawTopic else transferTopic
    }
    val op =
      JSONObject()
        .put(
          "proposal",
          JSONObject()
            .put("kind", "vaultRedeemAll")
            .put("expectedFrom", owner)
            .put("amountAtoms", "10"),
        )
    val step = JSONObject().put("to", ETH_EARN_ROUTER)
    fun transfer(token: String, from: String, to: String, amount: String) =
      JSONObject()
        .put("address", token)
        .put(
          "topics",
          JSONArray()
            .put(transferTopic)
            .put("0x" + earnAddressWord(from))
            .put("0x" + earnAddressWord(to)),
        )
        .put("data", "0x" + earnNumberWord(amount))
    val logs =
      JSONArray()
        .put(transfer(ETH_EARN_VAULT, owner, zero, "10"))
        .put(
          JSONObject()
            .put("address", ETH_EARN_VAULT)
            .put(
              "topics",
              JSONArray()
                .put(withdrawTopic)
                .put("0x" + earnAddressWord(ETH_EARN_ROUTER))
                .put("0x" + earnAddressWord(ETH_EARN_ROUTER))
                .put("0x" + earnAddressWord(owner)),
            )
            .put("data", "0x" + earnNumberWord("1000000") + earnNumberWord("10"))
        )
        .put(transfer(ETH_EARN_USDC, ETH_EARN_ROUTER, owner, "1000000"))
    val receipt = JSONObject().put("logs", logs)
    requireEarnReceiptSemantics(op, step, receipt, topics)
    logs.getJSONObject(2).put("data", "0x" + earnNumberWord("999999"))
    assertThrows(IllegalStateException::class.java) {
      requireEarnReceiptSemantics(op, step, receipt, topics)
    }
    logs.getJSONObject(2).put("data", "0x" + earnNumberWord("1000000"))
    logs.getJSONObject(1).getJSONArray("topics").put(3, "0x" + earnAddressWord(ETH_EARN_ROUTER))
    assertThrows(Exception::class.java) { requireEarnReceiptSemantics(op, step, receipt, topics) }
  }

  @Test
  fun provenWithdrawalReleasesNonceButMarksUnsolicitedResidualShares() = runBlocking {
    val j = operation("vaultRedeemAll", "10")
    val rpc = Rpc()
    rpc.observedShares = "3"
    rpc.tx =
      JSONObject()
        .put("hash", hash)
        .put("from", owner)
        .put("to", ETH_EARN_ROUTER)
        .put("input", "0x6bbba4e0")
        .put("nonce", "0x4")
        .put("value", "0x0")
        .put("gas", "0x493e0")
        .put("maxFeePerGas", "0xa")
        .put("maxPriorityFeePerGas", "0x1")
    fun transfer(token: String, from: String, to: String, amount: String) =
      JSONObject()
        .put("address", token)
        .put(
          "topics",
          JSONArray().put(topic).put("0x" + earnAddressWord(from)).put("0x" + earnAddressWord(to)),
        )
        .put("data", "0x" + earnNumberWord(amount))
    val logs =
      JSONArray()
        .put(transfer(ETH_EARN_VAULT, owner, "0x" + "0".repeat(40), "10"))
        .put(
          JSONObject()
            .put("address", ETH_EARN_VAULT)
            .put(
              "topics",
              JSONArray()
                .put(topic)
                .put("0x" + earnAddressWord(ETH_EARN_ROUTER))
                .put("0x" + earnAddressWord(ETH_EARN_ROUTER))
                .put("0x" + earnAddressWord(owner)),
            )
            .put("data", "0x" + earnNumberWord("1000000") + earnNumberWord("10"))
        )
        .put(transfer(ETH_EARN_USDC, ETH_EARN_ROUTER, owner, "1000000"))
    rpc.receipt =
      JSONObject()
        .put("transactionHash", hash)
        .put("from", owner)
        .put("to", ETH_EARN_ROUTER)
        .put("status", "0x1")
        .put("gasUsed", "0x100")
        .put("effectiveGasPrice", "0xa")
        .put("blockNumber", "0x10")
        .put("blockHash", block)
        .put("logs", logs)
    reconcileEarnVaultOperations(j, rpc, { topic })
    val public = j.public(j.get("deposit-1"))
    assertEquals("residualShares", public["status"])
    assertEquals("3", public["residualShares"])
    assertFalse(public["blocked"] as Boolean)
    assertFalse(public["canResume"] as Boolean)
    assertEquals("finalized", j.get("deposit-1").steps()[0].getString("status"))
    assertEquals(0, rpc.sent)
  }

  @Test
  fun finalReceiptRequiresDepositEventAndReorgRelocks() = runBlocking {
    val j = operation()
    val rpc = Rpc()
    rpc.tx =
      JSONObject()
        .put("hash", hash)
        .put("from", owner)
        .put("to", ETH_EARN_ROUTER)
        .put("input", "0x6bbba4e0")
        .put("nonce", "0x4")
        .put("value", "0x0")
        .put("gas", "0x493e0")
        .put("maxFeePerGas", "0xa")
        .put("maxPriorityFeePerGas", "0x1")
    val receipt =
      JSONObject()
        .put("transactionHash", hash)
        .put("from", owner)
        .put("to", ETH_EARN_ROUTER)
        .put("status", "0x1")
        .put("gasUsed", "0x100")
        .put("effectiveGasPrice", "0xa")
        .put("blockNumber", "0x10")
        .put("blockHash", block)
        .put("logs", JSONArray())
    rpc.receipt = receipt
    try {
      reconcileEarnVaultOperations(j, rpc, { topic })
      fail("Missing vault event must fail")
    } catch (_: Exception) {}
    assertTrue(j.get("deposit-1").earnBlocked())
    receipt.put(
      "logs",
      JSONArray()
        .put(
          JSONObject()
            .put("address", ETH_EARN_VAULT)
            .put(
              "topics",
              JSONArray()
                .put(topic)
                .put("0x" + earnAddressWord(ETH_EARN_ROUTER))
                .put("0x" + earnAddressWord(owner)),
            )
            .put("data", "0x" + earnNumberWord("1000000") + earnNumberWord("10"))
        ),
    )
    reconcileEarnVaultOperations(j, rpc, { topic })
    assertEquals("invested", j.public(j.get("deposit-1"))["status"])
    assertEquals("2560", j.public(j.get("deposit-1"))["actualFeeWei"])
    rpc.observedShares = "21"
    reconcileEarnVaultOperations(j, rpc, { topic })
    assertEquals("invested", j.public(j.get("deposit-1"))["status"])
    rpc.canonical = "0x" + "d".repeat(64)
    reconcileEarnVaultOperations(j, rpc, { topic })
    assertEquals("pending", j.get("deposit-1").steps()[0].getString("status"))
    assertTrue(j.get("deposit-1").earnBlocked())
    assertEquals(0, rpc.sent)
  }
}
