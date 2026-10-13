package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnDepositCoordinatorTest {
  @Test
  fun sponsorshipFailureIsReportedAndCannotBecomeCreditWaiting() = runBlocking {
    DepositFixtures.record().use { record ->
      val journal = testDepositJournal()
      val id = journal.loadOrCreate(record, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(record).put("journeyId", id)
      journal.saveReview(id, 1, review)
      val engines = Engines(record).apply { sponsorshipFailure = true }
      val coordinator = EarnDepositCoordinator(journal, engines)
      val grant = EarnDepositApproval.fromReview(record, review).apply { approveAfterPasskey(1000) }
      coordinator.confirmed(id, 2, grant)
      assertEquals("sponsorshipUnavailable", journal.publicSnapshot(id)["pauseReason"])
      coordinator.reconcile(id)
      assertEquals("sponsorshipUnavailable", journal.publicSnapshot(id)["pauseReason"])
      assertEquals(0, engines.signed)
      assertEquals(0, engines.payoutCreates)
    }
  }

  @Test
  fun readOnlyStatusCannotReplaceTheActualStopWithGenericCreditWaiting() = runBlocking {
    DepositFixtures.record().use { record ->
      val journal = testDepositJournal()
      val id = journal.loadOrCreate(record, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(record).put("journeyId", id)
      journal.saveReview(id, 1, review)
      val engines = Engines(record).apply { failedSignatureCommit = true }
      val coordinator = EarnDepositCoordinator(journal, engines)
      val grant = EarnDepositApproval.fromReview(record, review).apply { approveAfterPasskey(1000) }
      coordinator.confirmed(id, 2, grant)
      assertEquals("termsChanged", journal.publicSnapshot(id)["pauseReason"])
      coordinator.reconcile(id)
      assertEquals("termsChanged", journal.publicSnapshot(id)["pauseReason"])
      assertEquals(0, engines.signed)
      assertEquals(0, engines.payoutCreates)
    }
  }

  @Test
  fun onlyExplicitResumeRetriesPersistedUnsubmittedPayoutBytes() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val e =
        Engines(r).apply {
          creditReady = true
          investUnknown = true
        }
      val c = EarnDepositCoordinator(j, e)
      val grant = EarnDepositApproval.fromReview(r, review).apply { approveAfterPasskey(1000) }
      c.confirmed(id, 2, grant)
      assertEquals("payouts", j.get(id).getString("phase"))
      assertFalse(j.get(id).has("pauseReason"))
      c.cancel(id, j.get(id).getInt("revision"))
      val restarted = EarnDepositCoordinator(j, e)
      restarted.reconcile(id)
      assertEquals(0, e.savedPayoutRetries)
      val bytes = e.rows.getValue("payout-source0-invest").getString("signedData")
      e.investUnknown = false
      val remaining =
        EarnDepositApproval.fromRemainingReview(r, review, 1000).apply { approveAfterPasskey(1000) }
      restarted.resume(id, j.get(id).getInt("revision"), remaining)
      assertEquals(1, e.savedPayoutRetries)
      assertEquals(bytes, e.rows.getValue("payout-source0-invest").getString("signedData"))
      assertEquals(4, e.signed)
      assertEquals("invested", j.get(id).getString("phase"))
    }
  }

  internal class Engines(val record: WalletRecord) : EarnDepositEngines {
    val rows = mutableMapOf<String, JSONObject>()
    var signed = 0
    var savedPayoutRetries = 0
    var payoutCreates = 0
    var depositCreates = 0
    var creditReady = false
    var investUnknown = false
    var excessBudget = false
    var failedSource = false
    var failedSignatureCommit = false
    var sponsorshipFailure = false
    var failedPayoutRead = false
    val readySources = mutableSetOf<String>()
    var now = 1002L
    var onReconcile: (() -> Unit)? = null
    var holdPending = false

    override suspend fun registerFunding(row: JSONObject) =
      row.also { rows[it.getString("operationId")] = it }

    override suspend fun preparePayout(sourceId: String, leg: String) =
      DepositFixtures.payout(record, leg).also {
        val source = rows[sourceId]!!.getJSONObject("proposal")
        val amount = source.getString("amountAtoms")
        val offset =
          rows.values
            .filter { row ->
              row.getJSONObject("proposal").getString("kind") == "sourceFunding" &&
                row.getJSONObject("proposal").getInt("sourceAccountIndex") <
                  source.getInt("sourceAccountIndex")
            }
            .fold(java.math.BigInteger.ZERO) { n, row ->
              n + row.getJSONObject("proposal").getString("amountAtoms").toBigInteger()
            }
            .toString()
        it
          .getJSONObject("proposal")
          .put("operationId", sourceId)
          .put("sourceAccountIndex", source.getInt("sourceAccountIndex"))
          .put("sourceOwner", source.getString("expectedFrom"))
          .put("creditedAtoms", amount)
          .put("splitOffsetAtoms", offset)
          .put("amountAtoms", nativePayoutAmount(amount, offset, leg))
          .put("minimumDestinationAtoms", nativePayoutAmount(amount, offset, leg))
        it.put("operationId", "payout-$sourceId-$leg")
        payoutCreates++
        rows[it.getString("operationId")] = it
      }

    override suspend fun prepareDeposit(id: String, attributedAtoms: String) =
      DepositFixtures.deposit(record).put("operationId", id).also {
        depositCreates++
        it
          .getJSONObject("proposal")
          .put("operationId", id)
          .put("budgetAtoms", attributedAtoms)
          .put("amountAtoms", (attributedAtoms.toBigInteger() - 21000.toBigInteger()).toString())
        if (excessBudget) it.getJSONObject("proposal").put("budgetAtoms", "999999999")
        rows[id] = it
      }

    override fun child(stage: String, id: String) = rows[id] ?: error("Missing child journal")

    override suspend fun execute(stage: String, id: String, grant: EarnDepositApproval) {
      val row = child(stage, id)
      if (sponsorshipFailure) throw EarnRpcRejection("pm_getPaymasterData", -32000, "REJECTED")
      check(!failedSignatureCommit) { "Atomic child commit failed before submission" }
      grant.assertPrepared(
        record,
        stage,
        row,
        DepositFixtures.prepared()
          .put("minimumSharesAtoms", row.getJSONObject("proposal").getString("amountAtoms")),
        now,
      )
      grant.recordDurableSignature(stage, id, "durable-$id")
      if (stage == "payouts" && row.has("signedData")) savedPayoutRetries++ else signed++
      if (stage == "payouts") row.put("signedData", "durable-$id")
      when (stage) {
        "funding" -> row.put("status", if (failedSource) "reverted" else "finalized")
        "payouts" ->
          row
            .put(
              "status",
              if (investUnknown && row.getJSONObject("proposal").getString("leg") == "invest")
                "submissionUnknown"
              else if (holdPending && row.getJSONObject("proposal").getString("leg") == "hold")
                "submitted"
              else "paid",
            )
            .put("receivedAtoms", row.getJSONObject("proposal").getString("amountAtoms"))
        "deposit" -> row.put("status", "finalized").put("transactionHash", "0x" + "9".repeat(64))
      }
    }

    override suspend fun reconcile(
      stage: String,
      id: String,
      grant: EarnDepositApproval?,
    ): JSONObject {
      onReconcile?.invoke()
      if (failedPayoutRead && stage == "payouts" && child(stage, id).getString("status") == "paid")
        error("Provider unavailable during receipt refresh")
      return child(stage, id)
    }

    override fun credit(row: JSONObject): String? =
      if (
        (creditReady || row.getString("operationId") in readySources) &&
          row.getString("status") == "finalized"
      )
        row.getJSONObject("proposal").getString("amountAtoms")
      else null

    override fun payoutReceipt(row: JSONObject): String? =
      if (row.getString("status") == "paid") row.getString("receivedAtoms") else null

    override fun investment(row: JSONObject): DepositInvestment? =
      if (row.getString("status") == "finalized")
        DepositInvestment(
          row.getJSONObject("proposal").getString("amountAtoms"),
          row.getJSONObject("proposal").getString("amountAtoms"),
          row.getString("transactionHash"),
        )
      else null
  }

  @Test
  fun waitsForCreditAndUnknownInvestWithoutRepeatingPaidHoldThenStopsInvested() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val draft = j.loadOrCreate(r, 4663, null)
      val id = draft.getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val engines = Engines(r)
      val coordinator = EarnDepositCoordinator(j, engines)
      coordinator.confirmed(id, 2, a)
      assertEquals(0, engines.payoutCreates)
      assertEquals("settlingCredit", j.publicSnapshot(id)["phase"])
      assertNull(j.publicSnapshot(id)["pauseReason"])
      engines.creditReady = true
      engines.investUnknown = true
      coordinator.advance(id, a)
      assertEquals(2, engines.payoutCreates)
      assertEquals(0, engines.depositCreates)
      assertEquals("99000", j.publicSnapshot(id)["holdReceivedAtoms"])
      coordinator.advance(id, a)
      assertEquals(2, engines.payoutCreates)
      assertEquals(3, engines.signed)
      engines.rows["payout-source0-invest"]!!.put("status", "paid")
      coordinator.advance(id, a)
      assertEquals("invested", j.publicSnapshot(id)["phase"])
      assertEquals("870000", j.publicSnapshot(id)["depositedAtoms"])
      coordinator.cancel(id, j.get(id).getInt("revision"))
      assertEquals("invested", j.publicSnapshot(id)["phase"])
      coordinator.reconcile(id)
      assertEquals(4, engines.signed)
      assertEquals(1, engines.depositCreates)
    }
  }

  @Test
  fun creditWaitPassesNeverRewindPublishedPhaseToFunding() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val draft = j.loadOrCreate(r, 4663, null)
      val id = draft.getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val engines = Engines(r)
      val coordinator = EarnDepositCoordinator(j, engines)
      coordinator.confirmed(id, 2, a)
      assertEquals("settlingCredit", j.publicSnapshot(id)["phase"])
      val observed = mutableListOf<Any?>()
      engines.onReconcile = { observed.add(j.publicSnapshot(id)["phase"]) }
      repeat(3) { coordinator.advance(id, a) }
      assertEquals(listOf("settlingCredit"), observed.distinct())
      assertEquals("settlingCredit", j.publicSnapshot(id)["phase"])
    }
  }

  @Test
  fun bothPayoutLegsAreSentBeforeEitherReceiptIsVerifiedLikeSwap() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val draft = j.loadOrCreate(r, 4663, null)
      val id = draft.getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val engines = Engines(r)
      engines.creditReady = true
      engines.holdPending = true
      val coordinator = EarnDepositCoordinator(j, engines)
      coordinator.confirmed(id, 2, a)
      // The hold receipt is still unverified, yet the invest leg is already signed and sent.
      assertEquals(2, engines.payoutCreates)
      assertEquals(3, engines.signed)
      assertEquals("payouts", j.publicSnapshot(id)["phase"])
      engines.rows["payout-source0-hold"]!!.put("status", "paid")
      coordinator.advance(id, a)
      assertEquals(2, engines.payoutCreates)
      assertEquals(4, engines.signed)
      assertEquals("invested", j.publicSnapshot(id)["phase"])
    }
  }

  @Test
  fun staleConfirmationMissingChildAndUnrelatedTokensCannotBecomeAnotherSpend() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val e = Engines(r)
      val c = EarnDepositCoordinator(j, e)
      try {
        c.confirmed(id, 1, a)
        fail("stale revision accepted")
      } catch (_: IllegalStateException) {}
      assertEquals(0, e.signed)
      c.confirmed(id, 2, a)
      e.rows.clear()
      c.advance(id, a)
      assertEquals("recoveryRequired", j.publicSnapshot(id)["pauseReason"])
      assertEquals(1, e.signed)
    }
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val e =
        Engines(r).apply {
          creditReady = true
          excessBudget = true
        }
      val c = EarnDepositCoordinator(j, e)
      c.confirmed(id, 2, a)
      assertEquals("termsChanged", j.publicSnapshot(id)["pauseReason"])
      assertEquals(3, e.signed)
    }
  }

  @Test
  fun cumulativeSplitWithOddCreditsPreservesExactAggregateFloor() {
    assertEquals("700000", nativePayoutAmount("7000009", "0", "hold"))
    assertEquals("800001", nativePayoutAmount("8000009", "7000009", "hold"))
    assertEquals(
      "1500001",
      (nativePayoutAmount("7000009", "0", "hold").toBigInteger() +
          nativePayoutAmount("8000009", "7000009", "hold").toBigInteger())
        .toString(),
    )
  }

  @Test
  fun sourceFailureOrFailedDurableCommitNeverStartsPayouts() = runBlocking {
    for (commitFailure in listOf(false, true)) DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val e =
        Engines(r).apply {
          creditReady = true
          failedSource = !commitFailure
          failedSignatureCommit = commitFailure
        }
      val c = EarnDepositCoordinator(j, e)
      c.confirmed(id, 2, a)
      assertEquals(if (commitFailure) 0 else 1, e.signed)
      assertEquals(0, e.payoutCreates)
      assertEquals(0, e.depositCreates)
      assertEquals("paused", j.publicSnapshot(id)["phase"])
      assertEquals(1, j.get(id).getJSONObject("children").getJSONArray("funding").length())
    }
  }

  @Test
  fun explicitResumeReconcilesSavedPaidLegInsteadOfSubmittingItTwice() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      val review = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val e =
        Engines(r).apply {
          creditReady = true
          failedPayoutRead = true
        }
      val c = EarnDepositCoordinator(j, e)
      c.confirmed(id, 2, a)
      assertEquals(2, e.signed)
      assertEquals(1, e.payoutCreates)
      e.failedPayoutRead = false
      val resumed = EarnDepositApproval.fromRemainingReview(r, review, 1000)
      resumed.approveAfterPasskey(1000)
      c.resume(id, j.get(id).getInt("revision"), resumed)
      assertEquals(4, e.signed)
      assertEquals(2, e.payoutCreates)
      assertEquals(1, e.depositCreates)
      assertEquals("invested", j.publicSnapshot(id)["phase"])
      try {
        c.confirmed(id, 2, resumed)
        fail("Repeated confirm accepted")
      } catch (_: IllegalStateException) {}
      assertEquals(4, e.signed)
    }
  }

  @Test
  fun secondSourceCannotSignUntilFirstSourceCreditIsVerified() = runBlocking {
    DepositFixtures.record().use { r ->
      val review = DepositFixtures.review(r)
      val credits = listOf("7000009", "8000009")
      val rows =
        credits.mapIndexed { index, credit ->
          DepositFixtures.funding(r, index).also { row ->
            row
              .getJSONObject("proposal")
              .put("amountAtoms", credit)
              .put("budgetAtoms", (credit.toBigInteger() + 20000.toBigInteger()).toString())
              .put("fundingBatchSize", 2)
          }
        }
      val sources =
        credits.mapIndexed { index, credit ->
          val s = JSONObject(review.getJSONArray("sources").getJSONObject(0).toString())
          val offset = if (index == 0) "0" else credits[0]
          s.put("operationId", "source$index")
            .put("accountIndex", index)
            .put("address", publicAccountAddress(r, index))
            .put("amountAtoms", credit)
            .put("minimumCreditAtoms", credit)
            .put("budgetAtoms", rows[index].getJSONObject("proposal").getString("budgetAtoms"))
          for (leg in listOf("hold", "invest")) {
            val amount = nativePayoutAmount(credit, offset, leg)
            s.getJSONObject(leg)
              .put("inputAtoms", amount)
              .put("estimatedOutputAtoms", amount)
              .put("minimumOutputAtoms", amount)
          }
          s
        }
      review
        .put("fundingRows", org.json.JSONArray(rows))
        .put("sources", org.json.JSONArray(sources))
        .put("sourceBudgetAtoms", "15040018")
      review
        .getJSONObject("reservation")
        .put(
          "legs",
          org.json.JSONArray(
            rows.map { row ->
              val p = row.getJSONObject("proposal")
              JSONObject()
                .put("sourceIndex", p.getInt("sourceAccountIndex"))
                .put("address", p.getString("expectedFrom"))
                .put("operationId", row.getString("operationId"))
                .put("budgetAtoms", p.getString("budgetAtoms"))
            }
          ),
        )
      review
        .getJSONObject("deposit")
        .put("estimatedAssetsAtoms", "13479017")
        .put("minimumAssetsAtoms", "13479017")
        .put("minimumSharesAtoms", "13465538")
      val j = testDepositJournal()
      val id = j.loadOrCreate(r, 4663, null).getString("journeyId")
      review.put("journeyId", id)
      j.saveReview(id, 1, review)
      val a = EarnDepositApproval.fromReview(r, review)
      a.approveAfterPasskey(1000)
      val e = Engines(r)
      e.readySources.add("source1")
      val c = EarnDepositCoordinator(j, e)
      c.confirmed(id, 2, a)
      assertEquals(0, e.payoutCreates)
      assertEquals(1, e.signed)
      assertFalse(e.rows.getValue("source1").getString("status") == "finalized")
      e.readySources.add("source0")
      c.advance(id, a)
      assertEquals(4, e.payoutCreates)
      assertEquals(7, e.signed)
      assertEquals("1500001", j.publicSnapshot(id)["holdReceivedAtoms"])
      assertEquals("13500017", j.publicSnapshot(id)["investReceivedAtoms"])
      assertEquals("invested", j.publicSnapshot(id)["phase"])
    }
  }
}
