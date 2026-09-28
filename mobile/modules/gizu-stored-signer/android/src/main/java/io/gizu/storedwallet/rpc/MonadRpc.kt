package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject

internal interface TransferRpc {
  suspend fun call(method: String, params: JSONArray = JSONArray()): Any

  suspend fun text(method: String, vararg params: Any): String =
    call(method, JSONArray(params.toList())) as String
}

internal class MonadRpc(private val progress: (String) -> Unit = {}) : TransferRpc {
  private val transport = NativeRpcTransport()

  override suspend fun call(method: String, params: JSONArray): Any {
    val phase =
      when (method) {
        "eth_chainId" -> "Checking Monad testnet connection"
        "eth_gasPrice",
        "eth_maxPriorityFeePerGas" -> "Fetching current network fees"
        "eth_getTransactionCount" -> "Checking account nonce"
        "eth_getBalance" -> "Checking testnet MON balance"
        "eth_estimateGas" -> "Estimating transfer gas"
        "eth_getCode" -> "Checking account type"
        "eth_sendRawTransaction" -> "Submitting approved transfer"
        else -> "Checking transaction status"
      }
    progress(phase)
    android.util.Log.i("GizuTransfer", "RPC start: $method")
    try {
      val payload =
        JSONObject()
          .put("jsonrpc", "2.0")
          .put("id", 1)
          .put("method", method)
          .put("params", params)
          .toString()
      val response = JSONObject(transport.post(payload))
      if (response.has("error")) {
        val message = response.optJSONObject("error")?.optString("message")?.lowercase().orEmpty()
        throw RpcFailure(
          if ("insufficient" in message && ("fund" in message || "balance" in message))
            RpcFailureCode.INSUFFICIENT_FUNDS
          else RpcFailureCode.RPC
        )
      }
      check(response.getInt("id") == 1 && response.getString("jsonrpc") == "2.0")
      android.util.Log.i("GizuTransfer", "RPC complete: $method")
      return response.get("result")
    } catch (failure: Exception) {
      // Method names/codes only. Never log parameters, response bodies, credentials or errors.
      android.util.Log.w(
        "GizuTransfer",
        "RPC failed: $method code=" + ((failure as? RpcFailure)?.code?.name ?: "INVALID_RESPONSE"),
      )
      throw failure
    }
  }
}
