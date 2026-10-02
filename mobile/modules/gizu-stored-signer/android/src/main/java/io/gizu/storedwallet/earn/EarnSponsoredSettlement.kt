package io.gizu.storedwallet

import org.json.JSONObject
import uniffi.gizu_stored_signer_core.EarnReadAuthentication

/** Expectation is assembled from authenticated native quote + finalized origin receipt only. */
internal fun sponsoredSettlementExpected(op: JSONObject): JSONObject {
  check(op.getString("status") == "finalized")
  val p = op.getJSONObject("proposal")
  check(p.getString("kind") in setOf("sourceFunding", "hoodTokenReturn", "returnUsdc", "returnEth"))
  val proof = op.getJSONObject("stateBinding").getJSONObject("routeProof")
  check(
    proof.getString("operationId") == op.getString("operationId") &&
      proof.getLong("revision") == p.getLong("revision")
  )
  check(
    proof.getString("amountAtoms") == p.getString("amountAtoms") &&
      proof.getString("recipient").equals(p.getString("recipient"), true) &&
      proof.getString("confidentialAccount").equals(p.getString("confidentialAccount"), true)
  )
  check(proof.getString("refundOwner").equals(p.getString("expectedFrom"), true))
  earnHash(op.getString("transactionHash"))
  earnHash(proof.getString("authenticatedBodyHash"))
  earnNumberWord(proof.getString("minimumCreditAtoms"))
  return JSONObject()
    .put("operationId", op.getString("operationId"))
    .put("revision", op.getInt("revision"))
    .put("depositAddress", proof.getString("recipient"))
    .put("sourceOwner", p.getString("expectedFrom"))
    .put("confidentialAccount", proof.getString("confidentialAccount"))
    .put("originAsset", proof.getString("originAsset"))
    .put("amountAtoms", proof.getString("amountAtoms"))
    .put("minimumCreditAtoms", proof.getString("minimumCreditAtoms"))
    .put("transactionHash", op.getString("transactionHash"))
}

internal fun validateSponsoredSettlement(
  text: String,
  expected: JSONObject,
  now: Long = System.currentTimeMillis(),
): JSONObject {
  val row = JSONObject(text)
  check(row.getBoolean("authenticated") && row.getBoolean("operationScoped"))
  check(
    row.getString("operationId") == expected.getString("operationId") &&
      row.getInt("revision") == expected.getInt("revision")
  )
  check(
    row.getString("confidentialAddress").equals(expected.getString("confidentialAccount"), true) &&
      row.getString("assetId") == EARN_MONAD_ASSET
  )
  check(
    row.getString("depositAddress").equals(expected.getString("depositAddress"), true) &&
      row.getString("transactionHash").equals(expected.getString("transactionHash"), true)
  )
  check(now - row.getLong("timestampMs") in -5000L..60000L)
  val credited = row.getString("creditedAtoms")
  earnNumberWord(credited)
  when (row.getString("status")) {
    "credited" ->
      check(credited.toBigInteger() >= expected.getString("minimumCreditAtoms").toBigInteger())
    "awaitingSettlement" -> check(credited == "0")
    else -> error("Unsupported settlement status")
  }
  return row
}

internal fun sponsoredSettlementPublic(row: JSONObject): Map<String, Any> = buildMap {
  for (field in
    listOf(
      "operationId",
      "confidentialAddress",
      "assetId",
      "depositAddress",
      "transactionHash",
      "creditedAtoms",
      "status",
    )) put(field, row.getString(field))
  put("revision", row.getInt("revision"))
  put("timestampMs", row.getLong("timestampMs"))
  put("authenticated", true)
  put("operationScoped", true)
}

internal suspend fun readNativeSponsoredSettlement(
  auth: EarnReadAuthentication,
  expected: JSONObject,
): JSONObject {
  val request =
    JSONObject()
      .put(
        "signedData",
        JSONObject()
          .put("standard", "erc191")
          .put("payload", auth.payload)
          .put("signature", auth.signature),
      )
      .put("expected", expected)
  val response = NativeRpcTransport("$EARN_NATIVE_BACKEND/settlement").post(request.toString())
  return validateSponsoredSettlement(response, expected)
}
