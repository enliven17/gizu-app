package io.gizu.storedwallet.swap

import io.gizu.storedwallet.NativeRpcTransport
import io.gizu.storedwallet.WalletRecord
import io.gizu.storedwallet.earnWithdrawalIndices
import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.buildSwapHolding
import uniffi.gizu_stored_signer_core.decodeSwapSymbol
import uniffi.gizu_stored_signer_core.deriveAccountAddressRange
import uniffi.gizu_stored_signer_core.selectSwapHolding
import uniffi.gizu_stored_signer_core.swapHoldingIndices

/** Read-only balances at one block, across all locally allocated recipient accounts. */
internal class SwapHoldings(private val rpc: NativeRpcTransport = NativeRpcTransport(RPC)) {
  suspend fun read(record: WalletRecord, targets: List<String>): Map<String, Any?> {
    val indices =
      swapHoldingIndices(record.roleRegistry, earnWithdrawalIndices(record).map { it.toUInt() })
        .map { it.toInt() }
    val head = request(listOf("eth_chainId" to JSONArray(), "eth_blockNumber" to JSONArray()))
    check(quantity(head[0]) == BigInteger.valueOf(4663))
    val block = head[1]
    quantity(block)
    val addresses =
      indices.map { deriveAccountAddressRange(record.entropy, it.toUInt(), 1u).single() }
    val holdings =
      targets.distinct().mapNotNull { target ->
        require(target.matches(Regex("0x[0-9a-f]{40}")))
        val metadata =
          request(
            listOf(
              "eth_call" to call(target, "0x95d89b41", block),
              "eth_call" to call(target, "0x313ce567", block),
            )
          )
        val balances =
          addresses.chunked(40).flatMap { chunk ->
            request(
              chunk.map { address ->
                "eth_call" to
                  call(
                    target,
                    "0x70a08231" + address.removePrefix("0x").lowercase().padStart(64, '0'),
                    block,
                  )
              }
            )
          }
        val encoded =
          buildSwapHolding(target, indices.map { it.toUInt() }, balances, metadata[0], metadata[1])
        if (encoded == "null") null
        else {
          val item = JSONObject(encoded)
          val rows = item.getJSONArray("batches")
          mapOf(
            "token" to item.getString("token"),
            "chainId" to item.getLong("chainId"),
            "symbol" to item.getString("symbol"),
            "decimals" to item.getInt("decimals"),
            "balanceAtoms" to item.getString("balanceAtoms"),
            "batches" to
              (0 until rows.length()).map { i ->
                val row = rows.getJSONObject(i)
                mapOf("id" to row.getString("id"), "balanceAtoms" to row.getString("balanceAtoms"))
              },
          )
        }
      }
    return mapOf(
      "holdings" to holdings,
      "checkedAt" to System.currentTimeMillis(),
      "block" to block,
    )
  }

  private suspend fun request(calls: List<Pair<String, JSONArray>>): List<String> {
    val payload =
      JSONArray(
        calls.mapIndexed { index, (method, params) ->
          JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", index)
            .put("method", method)
            .put("params", params)
        }
      )
    val (status, body) = rpc.execute("POST", RPC, payload.toString())
    check(status in 200..299) { "Token balances unavailable. Retry." }
    return results(body, calls.size)
  }

  companion object {
    private const val RPC = "https://rpc.mainnet.chain.robinhood.com"

    private fun call(target: String, data: String, block: String) =
      JSONArray().put(JSONObject().put("to", target).put("data", data)).put(block)

    internal fun results(body: String, count: Int): List<String> {
      val values = JSONArray(body)
      require(values.length() == count)
      val byId = mutableMapOf<Int, String>()
      for (index in 0 until values.length()) {
        val item = values.getJSONObject(index)
        val id = item.getInt("id")
        require(id in 0 until count && !byId.containsKey(id) && !item.has("error"))
        byId[id] = item.getString("result")
      }
      return (0 until count).map { checkNotNull(byId[it]) }
    }

    internal fun quantity(value: String): BigInteger {
      require(value.matches(Regex("0x[0-9a-fA-F]{1,64}")))
      return BigInteger(value.substring(2), 16)
    }

    internal fun decodeSymbol(value: String): String = decodeSwapSymbol(value)

    /** JS chooses an opaque batch ID; ownership and allocated range are checked natively. */
    internal fun selection(
      id: String,
      nextRecipient: Int,
      tracked: List<String>,
      excluded: Set<Int> = emptySet(),
    ): Pair<String, List<Int>> {
      val selected =
        selectSwapHolding(
          id,
          JSONObject().put("version", 1).put("nextRecipient", nextRecipient).toString(),
          excluded.map { it.toUInt() },
          tracked,
        )
      return selected.target to selected.indices.map { it.toInt() }
    }
  }
}
