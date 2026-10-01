package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnFusionGatewayTest {
  private val hash = "0x" + "a".repeat(64)
  private val owner = "0x" + "1".repeat(40)
  private val confidential = "0x" + "2".repeat(40)

  private fun row(executable: Boolean = false) =
    JSONObject()
      .put("operationId", "fusion-1")
      .put("revision", 7)
      .put("quoteId", hash)
      .put("owner", owner)
      .put("confidentialAccount", confidential)
      .put("inputAtoms", "1000")
      .put("minimumEthWei", "10")
      .put("grossEthWei", "11")
      .put("deadline", "400")
      .put("quotedAt", 100)
      .put("expiresAt", 160)
      .put("orderHash", hash)
      .put("extensionHash", hash)
      .put("authenticatedBodyHash", "0x" + "b".repeat(64))
      .put("resolverGasUnits", "10")
      .put("resolverGasPriceWei", "125")
      .put("requestedResolverGasPriceWei", "100")
      .put("resolverGasCostWei", "1250")
      .put("resolverProfitWei", "1")
      .put("inputValueWei", "1262")
      .put("unsignedOrder", JSONObject().put("makerTraits", "0"))
      .put("extension", "0x")
      .put("executable", executable)

  private fun p() =
    JSONObject()
      .put("operationId", "fusion-1")
      .put("revision", 7)
      .put("quoteId", hash)
      .put("expectedFrom", owner)
      .put("confidentialAccount", confidential)
      .put("inputAtoms", "1000")
      .put("minimumEthWei", "10")
      .put("maximumResolverOverheadWei", "1300")
      .put("deadline", 400)

  @Test
  fun executableQuoteUsesOriginalGasPriceAndSavedDeadlineWithoutDoubleBuffer() = runBlocking {
    val routes = mutableListOf<String>()
    val gateway =
      NativeFusionGateway(
        { endpoint, body ->
          routes.add(endpoint)
          if (endpoint == "quote") {
            val request = JSONObject(body)
            assertEquals("100", request.getString("resolverGasPriceWei"))
            assertEquals(400L, request.getLong("originalDeadline"))
            assertTrue(request.getBoolean("executionRequested"))
          }
          row(endpoint == "quote").toString()
        },
        { hash },
        { 100 },
      )
    val quote = gateway.executable(p(), null, null)
    assertTrue(quote.executionAvailable)
    assertEquals(listOf("quote-binding", "quote"), routes)
    assertEquals(400L, gateway.public(quote)["deadline"])
    assertEquals("125", quote.binding.resolverGasPriceWei)
  }

  @Test
  fun savedNativePermitMetadataCanRequestFreshQuoteAfterPreviewExpires() = runBlocking {
    val gateway =
      NativeFusionGateway(
        { endpoint, body ->
          assertEquals("quote", endpoint)
          assertEquals("100", JSONObject(body).getString("resolverGasPriceWei"))
          row(true).put("quotedAt", 200).put("expiresAt", 260).toString()
        },
        { hash },
        { 200 },
      )
    assertTrue(gateway.executable(p(), null, "100").executionAvailable)
  }

  @Test
  fun tlsBodyHashDoesNotTrustEchoedServerHashAndChangedOwnerCannotBind() = runBlocking {
    val gateway = NativeFusionGateway({ _, _ -> row().toString() }, { hash }, { 100 })
    assertEquals(hash, gateway.binding(p()).binding.authenticatedBodyHash)
    val changed =
      NativeFusionGateway(
        { _, _ -> row().put("owner", confidential).toString() },
        { hash },
        { 100 },
      )
    try {
      changed.binding(p())
      fail("Changed owner")
    } catch (_: IllegalStateException) {}
  }

  @Test
  fun previewAndStaleQuotesCannotBecomeExecutableOrders() = runBlocking {
    val preview = NativeFusionGateway({ _, _ -> row().toString() }, { hash }, { 100 })
    try {
      preview.executable(p(), null, "100")
      fail("Preview must fail")
    } catch (_: IllegalStateException) {}
    val stale = NativeFusionGateway({ _, _ -> row().toString() }, { hash }, { 200 })
    try {
      stale.binding(p())
      fail("Stale quote must fail")
    } catch (_: IllegalStateException) {}
  }

  @Test
  fun portableQuoteRecoveryIsPrivateAndBoundToExactSavedOperation() = runBlocking {
    val secret = "v1.private.encrypted.envelope"
    val gateway =
      NativeFusionGateway(
        { endpoint, body ->
          assertEquals("quote-binding", endpoint)
          assertEquals(secret, JSONObject(body).getString("recoveryEnvelope"))
          row(true).put("recoveryEnvelope", secret).toString()
        },
        { hash },
        { 100 },
      )
    val q = gateway.binding(p().put("recoveryEnvelope", secret))
    assertEquals(secret, q.raw.getString("recoveryEnvelope"))
    assertFalse(gateway.public(q).containsKey("recoveryEnvelope"))
  }
}
