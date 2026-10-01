package io.gizu.storedwallet

import org.json.JSONObject
import uniffi.gizu_stored_signer_core.*

internal data class NativeFusionQuote(
  val binding: NativeFusionQuoteBinding,
  val unsignedOrder: JSONObject,
  val extension: String,
  val executionAvailable: Boolean,
  val raw: JSONObject,
)

internal class NativeFusionGateway(
  private val post: suspend (String, String) -> String = { endpoint, body ->
    NativeRpcTransport("$EARN_NATIVE_BACKEND/fusion/$endpoint").post(body)
  },
  private val bodyHash: (String) -> String = ::utf8EarnHash,
  private val now: () -> Long = { System.currentTimeMillis() / 1000 },
) {
  private fun parse(text: String): NativeFusionQuote {
    val q = JSONObject(text)
    val quoted = q.getLong("quotedAt")
    val expires = q.getLong("expiresAt")
    val deadline = q.getLong("deadline")
    check(
      now() - quoted in -5L..60L &&
        expires > now() &&
        expires <= quoted + 600 &&
        deadline > now() &&
        deadline <= now() + 600
    )
    val values =
      listOf(
        "inputAtoms",
        "minimumEthWei",
        "grossEthWei",
        "resolverGasUnits",
        "resolverGasPriceWei",
        "resolverGasCostWei",
        "resolverProfitWei",
        "inputValueWei",
      )
    for (field in values) earnNumberWord(q.getString(field))
    earnAddressWord(q.getString("owner"))
    earnAddressWord(q.getString("confidentialAccount"))
    val binding =
      NativeFusionQuoteBinding(
        q.getString("operationId"),
        q.getLong("revision").toULong(),
        q.getString("quoteId"),
        q.getString("owner"),
        q.getString("confidentialAccount"),
        q.getString("inputAtoms"),
        q.getString("minimumEthWei"),
        q.getString("grossEthWei"),
        deadline.toULong(),
        quoted.toULong(),
        expires.toULong(),
        earnHash(q.getString("orderHash")),
        earnHash(q.getString("extensionHash")),
        bodyHash(text),
        q.getString("resolverGasUnits"),
        q.getString("resolverGasPriceWei"),
        q.getString("resolverGasCostWei"),
        q.getString("resolverProfitWei"),
        q.getString("inputValueWei"),
      )
    return NativeFusionQuote(
      binding,
      q.getJSONObject("unsignedOrder"),
      q.getString("extension"),
      q.getBoolean("executable"),
      q,
    )
  }

  suspend fun quote(request: JSONObject): NativeFusionQuote =
    parse(post("quote", request.toString()))

  suspend fun binding(p: JSONObject): NativeFusionQuote {
    val request =
      JSONObject()
        .put("operationId", p.getString("operationId"))
        .put("revision", p.getLong("revision"))
        .put("quoteId", p.getString("quoteId"))
    if (p.has("recoveryEnvelope")) request.put("recoveryEnvelope", p.getString("recoveryEnvelope"))
    val q = parse(post("quote-binding", request.toString()))
    check(
      q.binding.operationId == p.getString("operationId") &&
        q.binding.revision == p.getLong("revision").toULong() &&
        q.binding.quoteId == p.getString("quoteId")
    )
    check(
      q.binding.owner.equals(p.getString("expectedFrom"), true) &&
        q.binding.confidentialAccount.equals(p.getString("confidentialAccount"), true)
    )
    return q
  }

  suspend fun executable(
    p: JSONObject,
    permit: NativeSignedFusionPermit?,
    savedRequestedGasPrice: String?,
  ): NativeFusionQuote {
    val requestedGasPrice =
      savedRequestedGasPrice ?: binding(p).raw.getString("requestedResolverGasPriceWei")
    earnNumberWord(requestedGasPrice)
    val request =
      JSONObject()
        .put("operationId", p.getString("operationId"))
        .put("revision", p.getLong("revision"))
        .put("owner", p.getString("expectedFrom"))
        .put("confidentialAccount", p.getString("confidentialAccount"))
        .put("inputAtoms", p.getString("inputAtoms"))
        .put("resolverGasPriceWei", requestedGasPrice)
        .put("minimumEthWei", p.getString("minimumEthWei"))
        .put("maximumResolverOverheadWei", p.getString("maximumResolverOverheadWei"))
        .put("executionRequested", true)
        .put("originalDeadline", p.getLong("deadline"))
    if (permit != null) request.put("permitData", permit.permitData)
    val q = quote(request)
    check(q.executionAvailable)
    return q
  }

  suspend fun submit(order: JSONObject, hash: String) {
    val response = JSONObject(post("submit", order.toString()))
    check(response.getString("orderHash").equals(hash, true))
  }

  suspend fun status(hash: String): JSONObject =
    JSONObject(post("status", JSONObject().put("orderHash", hash).toString()))

  fun public(q: NativeFusionQuote): Map<String, Any> = buildMap {
    val row = q.raw
    for (field in
      listOf(
        "operationId",
        "quoteId",
        "owner",
        "confidentialAccount",
        "inputAtoms",
        "minimumEthWei",
        "grossEthWei",
        "resolverGasUnits",
        "resolverGasPriceWei",
        "resolverGasCostWei",
        "resolverProfitWei",
        "inputValueWei",
        "orderHash",
        "extensionHash",
        "extension",
      )) put(field, row.getString(field))
    put("revision", row.getLong("revision"))
    put("deadline", row.getLong("deadline"))
    put("quotedAt", row.getLong("quotedAt"))
    put("expiresAt", row.getLong("expiresAt"))
    put("quotedAtMs", row.getLong("quotedAt") * 1000)
    put("expiresAtMs", row.getLong("expiresAt") * 1000)
    put("executable", q.executionAvailable)
    put(
      "unsignedOrder",
      row.getJSONObject("unsignedOrder").keys().asSequence().associateWith {
        row.getJSONObject("unsignedOrder").getString(it)
      },
    )
  }
}
