package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject

internal object DepositFixtures {
  const val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"

  fun record(generation: String = wallet, cycle: Int = 0) =
    WalletRecord(
      wallet,
      StoredPasskey(byteArrayOf(1), ByteArray(32), ByteArray(32)),
      ByteArray(32),
      true,
      generation,
      INITIAL_ROLE_REGISTRY,
      4663,
      false,
      cycle,
    )

  fun funding(r: WalletRecord, index: Int = 0): JSONObject {
    val owner = publicAccountAddress(r, index)
    return JSONObject()
      .put("operationId", "source$index")
      .put("walletId", wallet)
      .put("revision", 1)
      .put("status", "planned")
      .put(
        "proposal",
        JSONObject()
          .put("kind", "sourceFunding")
          .put("operationId", "source$index")
          .put("revision", 1)
          .put("chainId", 143)
          .put("profileChainId", 4663)
          .put("cycleIndex", r.earnCycleIndex)
          .put("sourceAccountIndex", index)
          .put("expectedFrom", owner)
          .put("token", MONAD_EARN_USDC)
          .put("amountAtoms", "990000")
          .put("budgetAtoms", "1010000")
          .put("maximumTokenFeeAtoms", "10000")
          .put("withdrawalReserveAtoms", "10000")
          .put("confidentialAccount", cycleConfidential(r))
          .put("refundOwner", owner)
          .put("nonce", "0x0")
          .put("deadline", 9999)
          .put("quoteId", "quote$index")
          .put("recipient", "0x" + "8".repeat(40))
          .put("fundingBatchId", "batch1")
          .put("fundingBatchSize", 1),
      )
      .put(
        "unsignedUserOperation",
        JSONObject()
          .put("sender", owner)
          .put("nonce", "0x0")
          .put("callData", "0xab")
          .put("maxFeePerGas", "0x10")
          .put("maxPriorityFeePerGas", "0x1")
          .put("callGasLimit", "0x10")
          .put("verificationGasLimit", "0x10")
          .put("preVerificationGas", "0x10")
          .put("signature", "0x"),
      )
  }

  fun review(r: WalletRecord): JSONObject {
    val addresses = cycleAddresses(r)
    fun leg(n: Int, input: String) =
      JSONObject()
        .put("recipient", addresses[n])
        .put("inputAtoms", input)
        .put("estimatedOutputAtoms", input)
        .put("minimumOutputAtoms", input)
        .put("providerFeeBps", 4)
    val source = funding(r)
    return JSONObject()
      .put("walletId", r.id)
      .put("generation", r.journalId)
      .put("cycleIndex", r.earnCycleIndex)
      .put("roleRegistry", JSONObject(r.roleRegistry))
      .put("profileChainId", 4663)
      .put("confidentialAccount", cycleConfidential(r))
      .put("journeyId", "journey1")
      .put("policyVersion", "robinhood-v1")
      .put("quotedAtMs", 1000)
      .put("expiresAtMs", 46000)
      .put("sourceBudgetAtoms", "1010000")
      .put("destinations", JSONArray(addresses))
      .put("fundingRows", JSONArray().put(source))
      .put(
        "reservation",
        JSONObject()
          .put("id", "batch1")
          .put("feature", "earn")
          .put("cycleIndex", r.earnCycleIndex)
          .put("registrationComplete", true)
          .put(
            "legs",
            JSONArray()
              .put(
                JSONObject()
                  .put("sourceIndex", 0)
                  .put("address", publicAccountAddress(r, 0))
                  .put("budgetAtoms", "1010000")
                  .put("operationId", "source0")
              ),
          ),
      )
      .put(
        "sources",
        JSONArray()
          .put(
            JSONObject()
              .put("operationId", "source0")
              .put("accountIndex", 0)
              .put("address", publicAccountAddress(r, 0))
              .put("budgetAtoms", "1010000")
              .put("amountAtoms", "990000")
              .put("maximumFeeAtoms", "10000")
              .put("retainedAtoms", "10000")
              .put("minimumCreditAtoms", "990000")
              .put("hold", leg(0, "99000"))
              .put("invest", leg(1, "891000"))
          ),
      )
      .put(
        "deposit",
        JSONObject()
          .put("estimatedAssetsAtoms", "870000")
          .put("minimumAssetsAtoms", "870000")
          .put("minimumSharesAtoms", "860000")
          .put("shareDecimals", 18)
          .put("maximumFeeAtoms", "10000")
          .put("withdrawalReserveAtoms", "11000"),
      )
  }

  fun payout(r: WalletRecord, leg: String = "hold") =
    JSONObject()
      .put("operationId", "payout-$leg")
      .put("walletId", r.id)
      .put("status", "planned")
      .put(
        "proposal",
        JSONObject()
          .put("kind", "confidentialPayout")
          .put("operationId", "source0")
          .put("profileChainId", 4663)
          .put("cycleIndex", r.earnCycleIndex)
          .put("sourceAccountIndex", 0)
          .put("sourceOwner", publicAccountAddress(r, 0))
          .put("expectedSigner", cycleConfidential(r))
          .put("expectedRecipient", cycleAddresses(r)[if (leg == "hold") 0 else 1])
          .put("leg", leg)
          .put("creditedAtoms", "990000")
          .put("splitOffsetAtoms", "0")
          .put("amountAtoms", if (leg == "hold") "99000" else "891000")
          .put("minimumDestinationAtoms", if (leg == "hold") "99000" else "891000")
          .put("deadlineMs", 990000),
      )

  fun prepared() =
    JSONObject()
      .put("hash", "0x" + "a".repeat(64))
      .put("text", "Exact native review")
      .put("providerFeeBps", 4)

  fun deposit(r: WalletRecord) =
    JSONObject()
      .put("walletId", r.id)
      .put("operationId", "deposit1")
      .put("status", "planned")
      .put(
        "proposal",
        JSONObject()
          .put("kind", "hoodDeposit")
          .put("operationId", "deposit1")
          .put("profileChainId", 4663)
          .put("chainId", 4663)
          .put("cycleIndex", r.earnCycleIndex)
          .put("expectedFrom", cycleAddresses(r)[1])
          .put("token", HOOD_EARN_USDG)
          .put("vault", HOOD_EARN_VAULT)
          .put("router", HOOD_EARN_ROUTER)
          .put("amountAtoms", "870000")
          .put("budgetAtoms", "891000")
          .put("maximumTokenFeeAtoms", "10000")
          .put("withdrawalReserveAtoms", "11000")
          .put("slippageBps", 10)
          .put("deadline", 9900),
      )
}
