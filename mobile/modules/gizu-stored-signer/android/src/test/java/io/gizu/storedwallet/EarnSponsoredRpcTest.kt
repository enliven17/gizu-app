package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnSponsoredRpcTest {
  private val owner = "0x" + "ab".repeat(20)
  private val confidential = "0x" + "cd".repeat(20)
  private val recipient = "0x" + "ef".repeat(20)
  private val hash = "0x" + "a".repeat(64)

  private fun proposal() =
    JSONObject()
      .put("operationId", "source-1")
      .put("revision", 7)
      .put("quoteId", "route-1")
      .put("chainId", 143)
      .put("kind", "sourceFunding")
      .put("token", MONAD_EARN_USDC.lowercase())
      .put("amountAtoms", "1000000")
      .put("confidentialAccount", confidential)
      .put("refundOwner", owner)
      .put("recipient", recipient)
      .put("deadline", 600)

  private fun response() =
    proposal()
      .put("token", MONAD_EARN_USDC)
      .put("confidentialAccount", confidential.uppercase().replace("0X", "0x"))
      .put("refundOwner", owner.uppercase().replace("0X", "0x"))
      .put("recipient", recipient.uppercase().replace("0X", "0x"))
      .put("expiresAt", 700)
      .put("minimumCreditAtoms", "999800")
      .put("originAsset", EARN_MONAD_ASSET)
      .put("providerFeeBps", 2)
      .put("authenticatedBodyHash", hash)

  @Test
  fun independentlyFetchedBindingAcceptsEquivalentChecksummedAddresses() = runBlocking {
    var fetched = ""
    val gateway =
      NativeEarnQuoteGateway(
        { endpoint, body ->
          assertEquals("quote-binding", endpoint)
          assertEquals("route-1", JSONObject(body).getString("quoteId"))
          response().toString().also { fetched = it }
        },
        { body ->
          assertEquals(fetched, body)
          hash
        },
        { 100 },
      )
    val proof = gateway.binding(proposal())!!
    assertEquals("999800", proof.minimumCreditAtoms)
    assertEquals(hash, proof.binding.authenticatedBodyHash)
    assertEquals(owner.lowercase(), proof.binding.refundOwner.lowercase())
  }

  @Test
  fun nativeBindingRejectsChangedAmountIdFeeAndExpiredProof() = runBlocking {
    for (changed in
      listOf(
        response().put("amountAtoms", "1000001"),
        response().put("operationId", "other"),
        response().put("providerFeeBps", 4),
        response().put("expiresAt", 701),
      )) {
      val gateway = NativeEarnQuoteGateway({ _, _ -> changed.toString() }, { hash }, { 100 })
      try {
        gateway.binding(proposal())
        fail("Changed native quote must fail")
      } catch (_: IllegalStateException) {}
    }
  }

  @Test
  fun sourceQuoteRequiresFixedFeeAndBoundedAbsoluteExpiry() = runBlocking {
    val gateway =
      NativeEarnQuoteGateway(
        { endpoint, body ->
          assertEquals("source-quote", endpoint)
          val request = JSONObject(body)
          assertEquals(owner, request.getString("sourceOwner"))
          assertEquals(confidential, request.getString("confidentialAccount"))
          response().toString()
        },
        { hash },
        { 100 },
      )
    val quote = gateway.create(1, "source-1", 7, owner, confidential, "1000000", false)
    assertEquals(700L, quote["expiresAt"])
    assertEquals(2, quote["providerFeeBps"])
    val bad =
      NativeEarnQuoteGateway(
        { _, _ -> response().put("expiresAt", 701).toString() },
        { hash },
        { 100 },
      )
    try {
      bad.create(1, "source-1", 7, owner, confidential, "1000000", false)
      fail("Overlong quote must fail")
    } catch (_: IllegalStateException) {}
  }

  @Test
  fun qualifiedVariableFeesAreReturnedWithTheExactPolicyForReview() = runBlocking {
    val fees =
      JSONObject()
        .put("version", "qualified-2026")
        .put("route", "source")
        .put("totalBps", 4)
        .put(
          "appFees",
          JSONArray().put(JSONObject().put("recipient", "provider.near").put("fee", 4)),
        )
        .put("referral", "qualified")
        .put("integratorFeeBps", 0)
        .put("applicationFeeAtoms", "0")
    val gateway =
      NativeEarnQuoteGateway(
        { _, _ -> response().put("providerFeeBps", 4).put("feePolicy", fees).toString() },
        { hash },
        { 100 },
      )
    val quote = gateway.create(1, "source-1", 7, owner, confidential, "1000000", false)
    assertEquals(4, quote["providerFeeBps"])
    assertEquals("qualified-2026", (quote["feePolicy"] as Map<*, *>)["version"])
  }

  @Test
  fun financialSponsoredReadsUseOneCanonicalBlockAndRequireFreshBlock() = runBlocking {
    var pinnedReads = 0
    val rpc =
      object : TransferRpc {
        override suspend fun call(method: String, params: JSONArray): Any =
          when (method) {
            "eth_chainId" -> "0x8f"
            "eth_getBlockByNumber" ->
              JSONObject()
                .put("number", "0x10")
                .put("hash", hash)
                .put("parentHash", "0x" + "b".repeat(64))
                .put("timestamp", "0x" + (System.currentTimeMillis() / 1000).toString(16))
                .put("baseFeePerGas", "0x1")
            "eth_getTransactionCount" -> {
              if (params.get(1) is JSONObject) pinnedReads++
              "0x4"
            }
            "eth_getCode",
            "eth_call" -> {
              assertEquals(hash, params.getJSONObject(1).getString("blockHash"))
              assertTrue(params.getJSONObject(1).getBoolean("requireCanonical"))
              pinnedReads++
              if (method == "eth_getCode") {
                if (params.getString(0) in setOf(owner, recipient)) "0x" else "0x6000"
              } else
                "0x" +
                  "0".repeat(63) +
                  if (params.getJSONObject(0).getString("data") == "0x313ce567") "6" else "0"
            }
            else -> error("Unexpected $method")
          }
      }
    val state = EarnSponsoredStateLoader(rpc) { hash }.load(proposal().put("expectedFrom", owner))
    assertEquals("0x0", state.entryPointNonce)
    assertEquals(4uL, state.transactionNonce)
    assertEquals(11, pinnedReads)
  }
}
