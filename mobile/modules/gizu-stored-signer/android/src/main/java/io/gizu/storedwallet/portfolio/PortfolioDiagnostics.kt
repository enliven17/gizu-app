package io.gizu.storedwallet.portfolio

import android.util.Log
import io.gizu.storedwallet.BuildConfig
import io.gizu.storedwallet.RpcFailure
import org.json.JSONObject

/**
 * Debug diagnostics contain fixed labels only: never owners, amounts, payloads or response text.
 */
internal object PortfolioDiagnostics {
  enum class Stage {
    RPC,
    TOKEN_SYNC,
    TOKEN_CACHE,
    TOKEN_CHAIN,
    TOKEN_HEAD,
    TOKEN_CHECKPOINT,
    TOKEN_LOGS,
    TOKEN_SAMPLE,
    TOKEN_BALANCES,
    TOKEN_CANONICAL,
    TOKEN_SAVE,
    OWNED_TOKEN,
    TOKEN_METADATA,
    VAULT_RATE,
    NATIVE_BALANCE,
    PRIVATE_SALT,
    PRIVATE_READ,
    PRIVATE_VALIDATION,
    PRIVATE_REFRESH,
    MAINNET_PUBLIC,
    MAINNET_OWNED,
  }

  enum class Reason {
    STARTED,
    READY,
    CACHE_FRESH,
    CACHE_STALE,
    CACHE_EMPTY,
    BALANCE_PENDING,
    SCAN_PENDING,
    SAMPLE_AHEAD,
    SYNC_PENDING,
    REQUEST_TIMEOUT,
    SOURCE_BUDGET_EXHAUSTED,
    CANCELLED,
    RPC_ERROR,
    PRUNED_STATE,
    LOG_RANGE_LIMIT,
    INVALID_BLOCK_SELECTOR,
    MALFORMED_RESPONSE,
    PROVIDER_FAILURE,
    AUTH_REQUIRED,
    PARTIAL,
    UNAVAILABLE,
    VALIDATION_FAILED,
    ADDRESS_BINDING_INVALID,
    AUTH_FLAGS_INVALID,
    ASSET_INVALID,
    AMOUNT_TYPE_INVALID,
    AMOUNT_INVALID,
    TIMESTAMP_TYPE_INVALID,
    TIMESTAMP_INVALID,
    SALT_INVALID,
  }

  fun event(
    stage: Stage,
    reason: Reason,
    chain: Long? = null,
    method: String? = null,
    failure: Exception? = null,
    status: Int? = null,
  ) {
    if (!BuildConfig.DEBUG) return
    val safeMethod =
      when (method) {
        "eth_chainId",
        "eth_getBlockByNumber",
        "eth_getLogs",
        "eth_call",
        "eth_getBalance",
        "batch" -> method
        else -> "none"
      }
    val failureCode = (failure as? RpcFailure)?.code?.name ?: "none"
    val failureClass =
      failure?.javaClass?.simpleName?.takeIf { it.matches(Regex("[A-Za-z0-9_]{1,64}")) } ?: "none"
    runCatching {
      Log.d(
        "GizuPortfolio",
        "stage=${stage.name} reason=${reason.name} chain=${chain ?: 0L} method=$safeMethod class=$failureClass transport=$failureCode status=${status ?: 0}",
      )
    }
  }

  fun rpcReason(error: JSONObject): Reason {
    val text = error.optString("message").lowercase()
    return when {
      "prun" in text ||
        "historical state" in text ||
        "state not available" in text ||
        "missing trie" in text -> Reason.PRUNED_STATE
      "block range" in text || "range too" in text || "too many blocks" in text ->
        Reason.LOG_RANGE_LIMIT
      "blockhash" in text || "block hash" in text || "eip-1898" in text ->
        Reason.INVALID_BLOCK_SELECTOR
      else -> Reason.RPC_ERROR
    }
  }
}
