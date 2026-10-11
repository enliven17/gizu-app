package io.gizu.storedwallet

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnDepositApprovalTest {
  private fun fails(action: () -> Unit) {
    assertThrows(IllegalStateException::class.java, action)
  }

  @Test
  fun expiryBackwardsGenerationCycleAndInvalidationNeverRenewAuthority() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      val child = DepositFixtures.funding(r)
      fails { a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 1000) }
      a.approveAfterPasskey(1000)
      a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 1001)
      DepositFixtures.record("27cfcc2e-0891-4e31-a7d4-03780d7b4f12").use {
        fails { a.assertPrepared(it, "funding", child, DepositFixtures.prepared(), 1002) }
      }
      DepositFixtures.record(cycle = 1).use {
        fails { a.assertPrepared(it, "funding", child, DepositFixtures.prepared(), 1002) }
      }
      a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 900999)
      fails { a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 901000) }
      fails { a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 999) }
      a.invalidate()
      fails { a.approveAfterPasskey(1001) }
      fails { a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 1001) }
    }
  }

  @Test
  fun sourceMembershipAndExactFundingCapsCannotChange() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      a.approveAfterPasskey(1000)
      for (field in
        listOf(
          "amountAtoms",
          "maximumTokenFeeAtoms",
          "expectedFrom",
          "token",
          "confidentialAccount",
          "budgetAtoms",
        )) {
        val child = DepositFixtures.funding(r)
        child.getJSONObject("proposal").put(field, "changed")
        fails { a.assertPrepared(r, "funding", child, DepositFixtures.prepared(), 1001) }
      }
      fails {
        a.assertPrepared(
          r,
          "withdrawal",
          DepositFixtures.funding(r),
          DepositFixtures.prepared(),
          1001,
        )
      }
      fails {
        a.assertPrepared(r, "return", DepositFixtures.funding(r), DepositFixtures.prepared(), 1001)
      }
    }
  }

  @Test
  fun payoutsWaitForAllCreditsAndCheckSplitRecipientsMinimaAndFees() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      a.approveAfterPasskey(1000)
      val p = DepositFixtures.payout(r)
      fails { a.assertPrepared(r, "payouts", p, DepositFixtures.prepared(), 1001) }
      a.recordCredit("source0", "990000")
      a.assertPrepared(r, "payouts", p, DepositFixtures.prepared(), 1002)
      for ((field, value) in
        listOf(
          "amountAtoms" to "99001",
          "splitOffsetAtoms" to "1",
          "minimumDestinationAtoms" to "98999",
          "expectedRecipient" to cycleAddresses(r)[1],
          "profileChainId" to "1",
        )) {
        val bad = DepositFixtures.payout(r)
        bad.getJSONObject("proposal").put(field, value)
        fails { a.assertPrepared(r, "payouts", bad, DepositFixtures.prepared(), 1003) }
      }
      fails {
        a.assertPrepared(r, "payouts", p, DepositFixtures.prepared().put("providerFeeBps", 5), 1003)
      }
      fails { a.recordCredit("source0", "989999") }
    }
  }

  @Test
  fun depositWaitsForReceiptsAndConstrainsVaultBudgetSharesAndReserve() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      a.approveAfterPasskey(1000)
      val proof = DepositFixtures.prepared().put("minimumSharesAtoms", "870000")
      fails { a.assertPrepared(r, "deposit", DepositFixtures.deposit(r), proof, 1001) }
      a.recordCredit("source0", "990000")
      a.recordPayout("source0", "hold", "99000")
      a.recordPayout("source0", "invest", "891000")
      a.assertPrepared(r, "deposit", DepositFixtures.deposit(r), proof, 1002)
      for ((field, value) in
        listOf(
          "vault" to MONAD_EARN_USDC,
          "token" to HOOD_EARN_VAULT,
          "router" to HOOD_EARN_VAULT,
          "amountAtoms" to "869999",
          "budgetAtoms" to "891001",
          "maximumTokenFeeAtoms" to "10001",
          "withdrawalReserveAtoms" to "10999",
        )) {
        val child = DepositFixtures.deposit(r)
        child.getJSONObject("proposal").put(field, value)
        fails { a.assertPrepared(r, "deposit", child, proof, 1003) }
      }
      fails {
        a.assertPrepared(
          r,
          "deposit",
          DepositFixtures.deposit(r),
          proof.put("minimumSharesAtoms", "859999"),
          1003,
        )
      }
    }
  }

  @Test
  fun immutableSignaturesAndLogicalChildMembershipPreventBudgetReuse() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      a.approveAfterPasskey(1000)
      a.recordCredit("source0", "990000")
      val p = DepositFixtures.payout(r)
      a.assertPrepared(r, "payouts", p, DepositFixtures.prepared(), 1001)
      a.recordDurableSignature("payouts", "payout-hold", "signed-hash")
      a.recordDurableSignature("payouts", "payout-hold", "signed-hash")
      fails { a.recordDurableSignature("payouts", "payout-hold", "replacement") }
      fails { a.recordDurableSignature("payouts", "unregistered", "signature") }
      fails {
        a.assertPrepared(
          r,
          "payouts",
          p.put("operationId", "another-hold"),
          DepositFixtures.prepared(),
          1002,
        )
      }
      fails {
        EarnDepositApproval.fromReview(
          r,
          DepositFixtures.review(r)
            .put(
              "destinations",
              org.json.JSONArray(listOf(cycleAddresses(r)[1], cycleAddresses(r)[0])),
            ),
        )
      }
    }
  }

  @Test
  fun expiredReviewCannotCreateAnApprovedGrant() {
    DepositFixtures.record().use { r ->
      val a = EarnDepositApproval.fromReview(r, DepositFixtures.review(r))
      fails { a.approveAfterPasskey(46000) }
    }
  }

  @Test
  fun explicitRemainingApprovalNeverRenewsQuotesOrRestoresAuthorityAutomatically() {
    DepositFixtures.record().use { r ->
      val saved = DepositFixtures.review(r)
      val normal = EarnDepositApproval.fromReview(r, saved)
      val resumed = EarnDepositApproval.fromRemainingReview(r, saved, 100000)
      assertNotEquals(normal.digest, resumed.digest)
      fails { resumed.assertRead(r, 100000) }
      fails { normal.approveAfterPasskey(100000) }
      resumed.approveAfterPasskey(100001)
      resumed.assertRead(r, 100002)
      assertEquals(46000, resumed.review.getInt("expiresAtMs"))
      resumed.review.put("sourceBudgetAtoms", "999999999")
      assertEquals("1010000", resumed.review.getString("sourceBudgetAtoms"))
      val expiredChild = DepositFixtures.funding(r)
      expiredChild.getJSONObject("proposal").put("deadline", 1)
      fails {
        resumed.assertPrepared(r, "funding", expiredChild, DepositFixtures.prepared(), 100003)
      }
      fails {
        resumed.assertPrepared(
          r,
          "return",
          DepositFixtures.funding(r),
          DepositFixtures.prepared(),
          100003,
        )
      }
    }
  }
}
