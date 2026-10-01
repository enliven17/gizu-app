package io.gizu.storedwallet.swap

import io.gizu.storedwallet.NativeRpcTransport
import io.gizu.storedwallet.WalletRecord
import io.gizu.storedwallet.earnWithdrawalIndices
import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.deriveAccountAddressRange

/** Read-only balances at one block, across all locally allocated recipient accounts. */
internal class SwapHoldings(private val rpc: NativeRpcTransport = NativeRpcTransport(RPC)) {
  suspend fun read(record: WalletRecord, targets: List<String>): Map<String, Any?> {
    val end = JSONObject(record.roleRegistry).getInt("nextRecipient")
    require(end >= 3)
    val indices = (3 until end).filterNot { it in earnWithdrawalIndices(record) }
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
        val symbol = decodeSymbol(metadata[0])
        val decimals = quantity(metadata[1]).intValueExact().also { require(it in 0..36) }
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
              .map(::quantity)
          }
        val batches =
          balances.chunked(3).mapIndexedNotNull { index, amounts ->
            val total = amounts.fold(BigInteger.ZERO, BigInteger::add)
            if (total.signum() == 0) null
            else mapOf("id" to "$target:${indices[index * 3]}", "balanceAtoms" to total.toString())
          }
        if (batches.isEmpty()) null
        else
          mapOf(
            "token" to target,
            "chainId" to 4663,
            "symbol" to symbol,
            "decimals" to decimals,
            "balanceAtoms" to balances.fold(BigInteger.ZERO, BigInteger::add).toString(),
            "batches" to batches,
          )
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

    internal fun decodeSymbol(value: String): String {
      require(value.matches(Regex("0x(?:[0-9a-fA-F]{2})+")))
      val bytes = value.substring(2).chunked(2).map { it.toInt(16).toByte() }.toByteArray()
      require(bytes.size >= 64)
      require(BigInteger(1, bytes.copyOfRange(0, 32)) == BigInteger.valueOf(32))
      val size = BigInteger(1, bytes.copyOfRange(32, 64)).intValueExact()
      require(size in 1..64 && bytes.size >= 64 + size)
      return String(bytes, 64, size, Charsets.UTF_8).also { require(it.none(Char::isISOControl)) }
    }

    /** JS chooses an opaque batch ID; ownership and allocated range are checked natively. */
    internal fun selection(
      id: String,
      nextRecipient: Int,
      tracked: List<String>,
      excluded: Set<Int> = emptySet(),
    ): Pair<String, List<Int>> {
      val parts = id.split(':')
      require(parts.size == 2 && parts[0] in tracked)
      val first = parts[1].toInt()
      val indices =
        (3 until nextRecipient)
          .filterNot { it in excluded }
          .chunked(3)
          .singleOrNull { it.size == 3 && it.first() == first }
      require(indices != null)
      return parts[0] to indices
    }
  }
}
