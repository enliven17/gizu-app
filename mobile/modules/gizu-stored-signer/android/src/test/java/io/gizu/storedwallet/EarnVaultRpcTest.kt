package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnVaultRpcTest {
  private val owner = "0x" + "1".repeat(40)
  private val blockHash = "0x" + "a".repeat(64)
  private val parentHash = "0x" + "b".repeat(64)
  private val codeHash = "0x" + "c".repeat(64)

  private class Rpc(val handler: (String, JSONArray) -> Any) : TransferRpc {
    override suspend fun call(method: String, params: JSONArray) = handler(method, params)
  }

  @Test
  fun everyFinancialObservationUsesSameCanonicalHash() = runBlocking {
    var observed = 0
    val rpc = Rpc { method, params ->
      when (method) {
        "eth_chainId" -> "0x1"
        "eth_getBlockByNumber" ->
          JSONObject()
            .put("number", "0x10")
            .put("hash", blockHash)
            .put("parentHash", parentHash)
            .put("baseFeePerGas", "0x1")
            .put("timestamp", "0x64")
        "eth_getTransactionCount" -> {
          if (params.get(1) is JSONObject) {
            assertEquals(blockHash, params.getJSONObject(1).getString("blockHash"))
            observed++
          }
          "0x4"
        }
        "eth_getCode",
        "eth_getBalance",
        "eth_call" -> {
          val pinned = params.getJSONObject(1)
          assertEquals(blockHash, pinned.getString("blockHash"))
          assertTrue(pinned.getBoolean("requireCanonical"))
          observed++
          when (method) {
            "eth_getCode" -> if (params.getString(0) == owner) "0x" else "0x6000"
            "eth_getBalance" -> "0xde0b6b3a7640000"
            else -> {
              val data = params.getJSONObject(0).getString("data")
              when (data.take(10)) {
                "0x38d52e0f" -> "0x" + "0".repeat(24) + "a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
                "0x313ce567" -> "0x" + "0".repeat(63) + "6"
                else -> "0x" + "0".repeat(60) + "000a"
              }
            }
          }
        }
        else -> error("Unexpected $method")
      }
    }
    val state =
      EarnVaultStateLoader(rpc, { codeHash }, { 100L }).load(owner, "vaultDeposit", "1000000")
    assertEquals(blockHash, state.blockHash)
    assertEquals("10", state.shares)
    assertEquals(4uL, state.nonce)
    assertEquals(13, observed)
  }

  @Test
  fun staleFutureOrSelfParentedRpcBlockCannotBeLabeledFresh() {
    fun block(timestamp: String) =
      JSONObject()
        .put("number", "0x10")
        .put("hash", blockHash)
        .put("parentHash", parentHash)
        .put("timestamp", timestamp)
    requireFreshEarnBlock(block("0x64"), 100L)
    assertThrows(IllegalStateException::class.java) { requireFreshEarnBlock(block("0x27"), 100L) }
    assertThrows(IllegalStateException::class.java) { requireFreshEarnBlock(block("0x6a"), 100L) }
    assertThrows(IllegalStateException::class.java) {
      requireFreshEarnBlock(block("0x64").put("parentHash", blockHash), 100L)
    }
  }

  @Test
  fun wrongChainCannotReadOrBroadcast() = runBlocking {
    val rpc = Rpc { method, _ ->
      check(method == "eth_chainId")
      "0x279f"
    }
    try {
      EarnVaultStateLoader(rpc, { codeHash }).load(owner, "vaultDeposit", "1000000")
      fail("Expected wrong-chain failure")
    } catch (_: IllegalStateException) {}
  }

  @Test
  fun receiptRequiresExactInputAndFinalCanonicalVaultSemantics() {
    val step =
      JSONObject()
        .put("to", ETH_EARN_ROUTER)
        .put("data", "0x6bbba4e0")
        .put("nonce", "4")
        .put("valueWei", "0")
        .put("gasLimit", "300000")
        .put("maxFeePerGasWei", "10")
        .put("priorityFeePerGasWei", "1")
    val tx =
      JSONObject()
        .put("hash", codeHash)
        .put("from", owner)
        .put("to", ETH_EARN_ROUTER)
        .put("input", "0x6bbba4e0")
        .put("nonce", "0x4")
        .put("value", "0x0")
        .put("gas", "0x493e0")
        .put("maxFeePerGas", "0xa")
        .put("maxPriorityFeePerGas", "0x1")
    requireEarnTransaction(tx, step, owner, codeHash)
    tx.put("input", "0x095ea7b3")
    assertThrows(IllegalStateException::class.java) {
      requireEarnTransaction(tx, step, owner, codeHash)
    }
  }
}
