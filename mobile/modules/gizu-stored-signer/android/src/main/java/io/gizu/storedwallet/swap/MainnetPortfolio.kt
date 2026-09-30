package io.gizu.storedwallet.swap

import io.gizu.storedwallet.NativeRpcTransport
import io.gizu.storedwallet.WalletRecord
import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.deriveAccountAddressRange

/** Viewing only: querying mainnet does not change the retained testnet transfer policy. */
internal class MainnetPortfolio {
  private val rpc = NativeRpcTransport(RPC)

  suspend fun read(record: WalletRecord, history: List<Map<String, Any?>>): Map<String, Any?> {
    val end = JSONObject(record.roleRegistry).getInt("nextRecipient")
    require(end >= 3 && (end - 3) % 3 == 0)
    val head = request(listOf("eth_chainId" to JSONArray(), "eth_blockNumber" to JSONArray()))
    check(SwapHoldings.quantity(head[0]) == BigInteger.valueOf(143))
    val block = head[1]
    SwapHoldings.quantity(block)
    val indices = listOf(1) + (3 until end).toList()
    val addresses =
      indices.map { deriveAccountAddressRange(record.entropy, it.toUInt(), 1u).single() }
    val balances =
      addresses.chunked(40).flatMap { chunk ->
        request(
            chunk.map { address ->
              "eth_call" to
                JSONArray()
                  .put(
                    JSONObject()
                      .put("to", USDC)
                      .put(
                        "data",
                        "0x70a08231" + address.removePrefix("0x").lowercase().padStart(64, '0'),
                      )
                  )
                  .put(block)
            }
          )
          .map(SwapHoldings::quantity)
      }
    val total = balances.fold(BigInteger.ZERO, BigInteger::add)
    val funding = balances.first()
    return mapOf(
      "walletId" to record.id,
      "chainId" to 143,
      "asset" to "USDC",
      "decimals" to 6,
      "fundingAddress" to addresses.first(),
      "fundingAtoms" to funding.toString(),
      "returnAtoms" to total.subtract(funding).toString(),
      "totalAtoms" to total.toString(),
      "checkedAt" to System.currentTimeMillis(),
      "block" to block,
      "accounts" to
        indices.mapIndexedNotNull { index, account ->
          if (index != 0 && balances[index].signum() == 0) null
          else
            mapOf(
              "address" to addresses[index],
              "accountIndex" to account,
              "role" to if (index == 0) "funding" else "receiving",
              "balanceAtoms" to balances[index].toString(),
            )
        },
      "history" to history,
    )
  }

  private suspend fun request(calls: List<Pair<String, JSONArray>>): List<String> {
    val body =
      JSONArray(
        calls.mapIndexed { id, (method, params) ->
          JSONObject()
            .put("jsonrpc", "2.0")
            .put("id", id)
            .put("method", method)
            .put("params", params)
        }
      )
    val (status, result) = rpc.execute("POST", RPC, body.toString())
    check(status in 200..299) { "Monad USDC balance unavailable. Retry." }
    return SwapHoldings.results(result, calls.size)
  }

  companion object {
    private const val RPC = "https://rpc.monad.xyz"
    private const val USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603"
  }
}
