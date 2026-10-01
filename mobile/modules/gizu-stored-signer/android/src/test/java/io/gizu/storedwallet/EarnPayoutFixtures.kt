package io.gizu.storedwallet

import org.json.JSONObject

internal object EarnPayoutFixtures {
  val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  val owner = "0x" + "1".repeat(40)
  val C = "0x" + "4".repeat(40)
  val recipient = "0x" + "2".repeat(40)
  val hash = "0x" + "a".repeat(64)
  val nativeHash = "0x" + "b".repeat(64)
  val nonce = "mZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZk="
  const val now = 1000000L

  fun source(): JSONObject {
    val p =
      JSONObject()
        .put("kind", "sourceFunding")
        .put("operationId", "funding1")
        .put("revision", 7)
        .put("chainId", 143)
        .put("profileChainId", 1)
        .put("expectedFrom", owner)
        .put("amountAtoms", "1000100")
        .put("recipient", "0x" + "6".repeat(40))
        .put("confidentialAccount", C)
    val proof =
      JSONObject()
        .put("operationId", "funding1")
        .put("revision", 7)
        .put("quoteId", hash)
        .put("recipient", p.getString("recipient"))
        .put("refundOwner", owner)
        .put("confidentialAccount", C)
        .put("amountAtoms", "1000100")
        .put("minimumCreditAtoms", "1000000")
        .put("originAsset", EARN_MONAD_ASSET)
        .put("authenticatedBodyHash", hash)
    val settlement =
      JSONObject()
        .put("operationId", "funding1")
        .put("revision", 10)
        .put("confidentialAddress", C)
        .put("assetId", EARN_MONAD_ASSET)
        .put("depositAddress", proof.getString("recipient"))
        .put("transactionHash", hash)
        .put("timestampMs", now)
        .put("status", "credited")
        .put("creditedAtoms", "1000001")
        .put("authenticated", true)
        .put("operationScoped", true)
    return JSONObject()
      .put("operationId", "funding1")
      .put("revision", 11)
      .put("status", "finalized")
      .put("transactionHash", hash)
      .put("proposal", p)
      .put("stateBinding", JSONObject().put("routeProof", proof))
      .put("signedUserOperation", "private source signature")
      .put("settlement", settlement)
  }

  fun prepared(leg: String = "hold"): JSONObject {
    val tokenId = "imt:" + "ab".repeat(32) + ":$EARN_MONAD_ASSET"
    val amount = if (leg == "hold") "100000" else "900001"
    val credit =
      JSONObject()
        .put("operationId", "funding1")
        .put("revision", 7)
        .put("profileChainId", 1)
        .put("sourceQuoteId", hash)
        .put("sourceTransactionHash", hash)
        .put("sourceHistoryId", hash)
        .put("confidentialAccount", C)
        .put("sourceOwner", owner)
        .put("sourceAssetId", EARN_MONAD_ASSET)
        .put("sourceToken", MONAD_EARN_USDC)
        .put("sourceChainId", 143)
        .put("sourceDecimals", 6)
        .put("creditedAtoms", "1000001")
        .put("privateTokenId", tokenId)
        .put("observedAtMs", now)
        .put("expiresAtMs", now + 60000)
        .put("authenticatedBodyHash", hash)
    val q =
      JSONObject(credit.toString())
        .put("leg", leg)
        .put("quoteId", hash)
        .put("depositId", "deposit.example")
        .put("refundAccount", C)
        .put("sourceCreditBodyHash", hash)
        .put("amountAtoms", amount)
        .put("destinationChainId", 1)
        .put("destinationToken", ETH_EARN_USDC)
        .put("destinationRecipient", recipient)
        .put("minimumDestinationAtoms", "1")
        .put("deadlineMs", now + 240000)
        .put("expiresAtMs", now + 240000)
        .put("payloadHash", nativeHash)
        .put("feeBps", 2)
        .put("integratorFeeBps", 0)
        .put("applicationFeeAtoms", "0")
        .put("swapType", "EXACT_INPUT")
        .put("confidentiality", "advanced")
        .put("depositType", "CONFIDENTIAL_INTENTS")
        .put("recipientType", "DESTINATION_CHAIN")
        .put("refundType", "CONFIDENTIAL_INTENTS")
        .put("referenceBlock", "10")
        .put("referenceHash", hash)
        .put("initialDestinationAtoms", "0")
    val payload =
      JSONObject()
        .put("signer_id", C.lowercase())
        .put("verifying_contract", "intents.far")
        .put("nonce", nonce)
        .put("deadline", "1970-01-01T00:20:40.000Z")
        .put(
          "intents",
          org.json
            .JSONArray()
            .put(
              JSONObject()
                .put("intent", "transfer")
                .put("receiver_id", "deposit.example")
                .put("tokens", JSONObject().put(tokenId, amount))
            ),
        )
    return JSONObject()
      .put("recoveryEnvelope", "v1.private-server-envelope")
      .put("sourceCredit", credit)
      .put("quote", q)
      .put("intent", JSONObject().put("standard", "erc191").put("payload", payload.toString()))
      .put("nativeJournalRequired", true)
      .put("executionAvailable", true)
  }
}
