package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnEthereumLiquidityRpcTest {
  @Test
  fun liquidityChecksDomainPermitNonceInvalidatorAssetsAndAllReadsAtOneHash() = runBlocking {
    val owner = "0x" + "1".repeat(40)
    val hash = "0x" + "a".repeat(64)
    var invalidator = false
    var permit = false
    var domain = false
    var observations = 0
    var pendingCount = "0x4"
    val rpc =
      object : TransferRpc {
        override suspend fun call(method: String, params: JSONArray): Any =
          when (method) {
            "eth_chainId" -> "0x1"
            "eth_getBlockByNumber" ->
              JSONObject()
                .put("number", "0x10")
                .put("hash", hash)
                .put("parentHash", "0x" + "b".repeat(64))
                .put("timestamp", "0x" + (System.currentTimeMillis() / 1000).toString(16))
                .put("baseFeePerGas", "0x1")
            "eth_getTransactionCount" -> {
              if (params.get(1) is JSONObject)
                assertEquals(hash, params.getJSONObject(1).getString("blockHash"))
              if (params.optString(1) == "pending") pendingCount else "0x4"
            }
            "eth_getBalance",
            "eth_getCode",
            "eth_call" -> {
              assertEquals(hash, params.getJSONObject(1).getString("blockHash"))
              assertTrue(params.getJSONObject(1).getBoolean("requireCanonical"))
              observations++
              if (method == "eth_getBalance") "0x0"
              else if (method == "eth_getCode") {
                if (params.getString(0) == owner) "0x" else "0x6000"
              } else {
                val target = params.getJSONObject(0).getString("to")
                val data = params.getJSONObject(0).getString("data")
                when (data.take(10)) {
                  "0x38d52e0f" -> "0x" + earnAddressWord(ETH_EARN_USDC)
                  "0x313ce567" -> "0x" + earnNumberWord(if (target == ETH_EARN_USDC) "6" else "18")
                  "0x143e86a7" -> {
                    invalidator = true
                    assertEquals(ETH_FUSION_ROUTER, target)
                    "0x" + earnNumberWord("0")
                  }
                  "0x7ecebe00" -> {
                    permit = true
                    "0x" + earnNumberWord("2")
                  }
                  "0x3644e515" -> {
                    domain = true
                    hash
                  }
                  else -> "0x" + earnNumberWord("0")
                }
              }
            }
            else -> error("Unexpected $method")
          }
      }
    val p =
      JSONObject()
        .put("expectedFrom", owner)
        .put("kind", "fusionEthOrder")
        .put("unsignedOrder", JSONObject().put("makerTraits", "0"))
    val s = EarnLiquidityStateLoader(rpc) { hash }.load(p)
    assertTrue(invalidator && permit && domain)
    assertTrue(observations >= 18)
    assertEquals("2", s.permitNonce)
    assertEquals(hash, s.usdcDomainSeparator)
    assertEquals(4uL, s.nonce)
    pendingCount = "0x5"
    try {
      EarnLiquidityStateLoader(rpc) { hash }.load(p)
      fail("Generic signing must reject pending-next nonce")
    } catch (_: IllegalStateException) {}
    val cancellation =
      JSONObject()
        .put("kind", "cancelPendingLiquidity")
        .put("expectedFrom", owner)
        .put("nonce", 4)
        .put("originalTransactionHash", hash)
    assertEquals(4uL, EarnLiquidityStateLoader(rpc) { hash }.loadCancellation(cancellation).nonce)
    pendingCount = "0x6"
    try {
      EarnLiquidityStateLoader(rpc) { hash }.loadCancellation(cancellation)
      fail("Unrelated later pending nonce must fail")
    } catch (_: IllegalStateException) {}
  }
}
