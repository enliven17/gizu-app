package io.gizu.storedwallet

import org.junit.Assert.*
import org.junit.Test

class EarnVaultPolicyTest {
  @Test
  fun publicProposalCannotChooseHolderOwnerOrArbitraryFields() {
    val owner = "0x" + "1".repeat(40)
    val request =
      mapOf<String, Any?>(
        "walletId" to "wallet",
        "kind" to "vaultDeposit",
        "operationId" to "deposit-1",
        "revision" to 1.0,
        "chainId" to 1.0,
        "expectedFrom" to owner,
        "vault" to ETH_EARN_VAULT,
        "token" to ETH_EARN_USDC,
        "router" to ETH_EARN_ROUTER,
        "amountAtoms" to "1000000",
        "deadline" to 1900000000.0,
        "slippageBps" to 10.0,
        "nonce" to 4.0,
        "gasLimits" to listOf(65000.0, 300000.0),
        "maxFeePerGasWei" to "10",
        "priorityFeePerGasWei" to "1",
        "maximumGasCostWei" to "3650000",
        "withdrawalReserveWei" to "1000000",
      )
    val canonical = canonicalEarnVaultProposal("wallet", owner, request)
    assertFalse(canonical.has("walletId"))
    assertEquals(owner, canonical.getString("expectedFrom"))
    assertEquals(4L, canonical.getLong("nonce"))
    assertThrows(Exception::class.java) {
      canonicalEarnVaultProposal("wallet", owner, request + ("data" to "0x"))
    }
    assertThrows(Exception::class.java) {
      canonicalEarnVaultProposal("wallet", owner, request + ("nonce" to 4.5))
    }
    assertThrows(Exception::class.java) {
      canonicalEarnVaultProposal(
        "wallet",
        owner,
        request + ("expectedFrom" to "0x" + "2".repeat(40)),
      )
    }
    assertThrows(Exception::class.java) { canonicalEarnVaultProposal("other", owner, request) }
  }

  @Test
  fun unsignedContinuationPreservesKindAmountAndRequiresNewReview() {
    val original =
      org.json
        .JSONObject()
        .put("kind", "vaultDeposit")
        .put("deadline", 1000)
        .put("amountAtoms", "1000000")
        .put("nonce", 4)
        .put("revision", 7)
        .put("gasLimits", org.json.JSONArray().put(65000).put(300000))
    val op =
      org.json
        .JSONObject()
        .put("proposal", original)
        .put("revision", 5)
        .put(
          "steps",
          org.json
            .JSONArray()
            .put(
              org.json
                .JSONObject()
                .put("raw", "0x02a")
                .put("status", "finalized")
                .put("to", ETH_EARN_USDC)
            )
            .put(org.json.JSONObject().put("status", "planned").put("to", ETH_EARN_ROUTER)),
        )
    val continuation = earnContinuationProposal(op, 5uL, 2000)
    assertEquals(2300L, continuation.getLong("deadline"))
    assertEquals(1000L, original.getLong("deadline"))
    assertEquals("0x02a", op.steps()[0].getString("raw"))
    assertEquals("vaultDeposit", continuation.getString("kind"))
    assertEquals("1000000", continuation.getString("amountAtoms"))
    assertEquals(5L, continuation.getLong("nonce"))
    assertEquals(1, continuation.getJSONArray("gasLimits").length())
    assertEquals(300000L, continuation.getJSONArray("gasLimits").getLong(0))
    op.steps()[0].put("status", "unknown")
    assertThrows(IllegalStateException::class.java) { earnContinuationProposal(op, 5uL) }
  }
}
