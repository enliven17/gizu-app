package io.gizu.storedwallet

import java.math.BigInteger
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

internal data class DepositInvestment(
  val assets: String,
  val shares: String,
  val transactionHash: String,
)

/** Implemented solely by an adapter to the existing semantic signing/reconciliation engines. */
internal interface EarnDepositEngines {
  fun useGrant(grant: EarnDepositApproval?) {}

  fun invested(journeyId: String) {}

  suspend fun registerFunding(row: JSONObject): JSONObject

  suspend fun preparePayout(sourceId: String, leg: String): JSONObject

  suspend fun prepareDeposit(id: String, attributedAtoms: String): JSONObject

  fun child(stage: String, id: String): JSONObject

  suspend fun execute(stage: String, id: String, grant: EarnDepositApproval)

  suspend fun reconcile(stage: String, id: String, grant: EarnDepositApproval?): JSONObject

  fun credit(row: JSONObject): String?

  fun payoutReceipt(row: JSONObject): String?

  fun investment(row: JSONObject): DepositInvestment?
}

/** One advance reconciles only this journey. Waiting/polling belongs to its native host job. */
internal class EarnDepositCoordinator(
  private val journal: EarnDepositJournal,
  private val engines: EarnDepositEngines,
) {
  private var activeGrant: EarnDepositApproval? = null

  suspend fun confirmed(journeyId: String, revision: Int, grant: EarnDepositApproval) {
    val row = journal.get(journeyId)
    check(
      activeGrant == null &&
        row.getInt("revision") == revision &&
        row.getString("phase") == "review"
    )
    check(depositCanonical(row.getJSONObject("review")) == depositCanonical(grant.review))
    activeGrant = grant
    engines.useGrant(grant)
    journal.update(journeyId, revision) { it.put("phase", "funding") }
    advance(journeyId, grant)
  }

  suspend fun resume(journeyId: String, revision: Int, grant: EarnDepositApproval) {
    val row = journal.get(journeyId)
    check(
      activeGrant == null &&
        row.getInt("revision") == revision &&
        row.getString("phase") == "paused"
    )
    check(depositCanonical(row.getJSONObject("review")) == depositCanonical(grant.review))
    activeGrant = grant
    engines.useGrant(grant)
    advance(journeyId, grant, retrySavedPayouts = true)
  }

  private fun setPhase(id: String, phase: String) {
    val row = journal.get(id)
    journal.update(id, row.getInt("revision")) {
      it.put("phase", phase)
      it.remove("pauseReason")
    }
  }

  private fun saveAmounts(id: String, action: (JSONObject) -> Unit) {
    val row = journal.get(id)
    journal.update(id, row.getInt("revision"), action)
  }

  private fun attach(id: String, stage: String, childId: String) {
    val row = journal.get(id)
    val list = row.getJSONObject("children").optJSONArray(stage)
    if (list == null || (0 until list.length()).none { list.getString(it) == childId })
      journal.attachChild(id, row.getInt("revision"), stage, childId)
  }

  private suspend fun reconcileAndExecute(
    stage: String,
    id: String,
    grant: EarnDepositApproval?,
    retrySavedPayouts: Boolean = false,
  ): JSONObject {
    var row = engines.reconcile(stage, id, grant)
    if (
      row.getString("status") in setOf("planned", "authorizationSaved", "signed") ||
        (stage == "payouts" &&
          retrySavedPayouts &&
          row.getString("status") == "submissionUnknown" &&
          row.has("signedData")) ||
        (stage == "payouts" && row.getString("status") == "cancelled" && !row.has("signedData"))
    ) {
      if (grant == null) return row
      engines.execute(stage, id, grant)
      row = engines.reconcile(stage, id, grant)
    }
    return row
  }

  suspend fun advance(id: String, grant: EarnDepositApproval?, retrySavedPayouts: Boolean = false) {
    val start = journal.get(id)
    if (start.getString("phase") == "invested") return
    if (grant != null) check(activeGrant === grant)
    try {
      val review = start.getJSONObject("review")
      val sources = review.getJSONArray("sources").objects().sortedBy { it.getInt("accountIndex") }
      val originalRows = review.getJSONArray("fundingRows").objects()
      setPhase(id, "funding")
      val credits = linkedMapOf<String, String>()
      for (s in sources) {
        val sourceId = s.getString("operationId")
        val children = journal.get(id).getJSONObject("children").optJSONArray("funding")
        val registered =
          children != null && (0 until children.length()).any { children.getString(it) == sourceId }
        if (!registered) {
          if (grant == null) {
            journal.pause(id, "approvalExpired")
            return
          }
          val created =
            engines.registerFunding(originalRows.single { it.getString("operationId") == sourceId })
          check(created.getString("operationId") == sourceId)
          attach(id, "funding", sourceId)
        }
      }
      // Register every selected source before the first can spend; a partial write cannot start a
      // batch.
      for (s in sources) engines.child("funding", s.getString("operationId"))
      for (s in sources) {
        val sourceId = s.getString("operationId")
        val row = reconcileAndExecute("funding", sourceId, grant)
        check(row.getString("status") != "reverted") { "Source funding failed" }
        val credit = engines.credit(row)
        if (credit == null) {
          saveAmounts(id) {
            it.put(
              "creditedAtoms",
              credits.values.fold(BigInteger.ZERO) { n, a -> n + depositAtoms(a) }.toString(),
            )
          }
          if (grant != null)
            setPhase(
              id,
              if (row.getString("status") == "finalized") "settlingCredit" else "funding",
            )
          else journal.pause(id, "settlementPending")
          return
        }
        credits[sourceId] = credit
        grant?.recordCredit(sourceId, credit)
      }
      saveAmounts(id) {
        it.put(
          "creditedAtoms",
          credits.values.fold(BigInteger.ZERO) { n, a -> n + depositAtoms(a) }.toString(),
        )
      }
      if (credits.size != sources.size) {
        if (grant != null) setPhase(id, "settlingCredit")
        else journal.pause(id, "settlementPending")
        return
      }
      saveAmounts(id) { it.put("completedSteps", JSONArray(listOf("funding", "credit"))) }
      setPhase(id, "payouts")
      val receipts = linkedMapOf<String, String>()
      for (source in sources) for (leg in listOf("hold", "invest")) {
        val sourceId = source.getString("operationId")
        val refs = journal.get(id).getJSONObject("children").optJSONArray(leg)
        var child =
          refs?.let { array ->
            (0 until array.length())
              .map { engines.child("payouts", array.getString(it)) }
              .singleOrNull { it.getJSONObject("proposal").getString("operationId") == sourceId }
          }
        if (child == null) {
          if (grant == null) {
            journal.pause(id, "approvalExpired")
            return
          }
          child = engines.preparePayout(sourceId, leg)
          check(
            child.getJSONObject("proposal").getString("operationId") == sourceId &&
              child.getJSONObject("proposal").getString("leg") == leg
          )
          attach(id, leg, child.getString("operationId"))
        }
        val settled =
          reconcileAndExecute("payouts", child.getString("operationId"), grant, retrySavedPayouts)
        val payoutAtoms = engines.payoutReceipt(settled)
        if (payoutAtoms == null) {
          saveAmounts(id) {
            it
              .put(
                "holdReceivedAtoms",
                sources
                  .fold(BigInteger.ZERO) { n, s ->
                    n + depositAtoms(receipts[s.getString("operationId") + ":hold"] ?: "0")
                  }
                  .toString(),
              )
              .put(
                "investReceivedAtoms",
                sources
                  .fold(BigInteger.ZERO) { n, s ->
                    n + depositAtoms(receipts[s.getString("operationId") + ":invest"] ?: "0")
                  }
                  .toString(),
              )
          }
          if (grant != null) setPhase(id, "payouts") else journal.pause(id, "submissionUnknown")
          return
        }
        payoutAtoms.let { atoms ->
          check(
            depositAtoms(atoms, true) >=
              depositAtoms(source.getJSONObject(leg).getString("minimumOutputAtoms"), true)
          )
          receipts["$sourceId:$leg"] = atoms
          grant?.recordPayout(sourceId, leg, atoms)
        }
      }
      val hold =
        sources.fold(BigInteger.ZERO) { n, s ->
          n + depositAtoms(receipts[s.getString("operationId") + ":hold"] ?: "0")
        }
      val invest =
        sources.fold(BigInteger.ZERO) { n, s ->
          n + depositAtoms(receipts[s.getString("operationId") + ":invest"] ?: "0")
        }
      saveAmounts(id) {
        it.put("holdReceivedAtoms", hold.toString()).put("investReceivedAtoms", invest.toString())
      }
      if (receipts.size != sources.size * 2) {
        if (grant != null) setPhase(id, "payouts") else journal.pause(id, "submissionUnknown")
        return
      }
      saveAmounts(id) {
        it.put("completedSteps", JSONArray(listOf("funding", "credit", "payouts")))
      }
      setPhase(id, "depositing")
      val depositId = "vault_$id"
      val refs = journal.get(id).getJSONObject("children").optJSONArray("deposit")
      if (refs == null) {
        if (grant == null) {
          journal.pause(id, "approvalExpired")
          return
        }
        val child = engines.prepareDeposit(depositId, invest.toString())
        check(child.getString("operationId") == depositId)
        check(
          depositAtoms(child.getJSONObject("proposal").getString("budgetAtoms"), true) <= invest
        )
        attach(id, "deposit", depositId)
      } else {
        check(refs.length() == 1 && refs.getString(0) == depositId)
        val existing = engines.child("deposit", depositId)
        if (
          grant != null &&
            !existing.sponsoredSpendSaved() &&
            existing.getString("status") in setOf("planned", "authorizationSaved")
        )
          engines.prepareDeposit(depositId, invest.toString())
      }
      val settled = reconcileAndExecute("deposit", depositId, grant)
      val investment = engines.investment(settled)
      if (investment == null) {
        if (grant != null) setPhase(id, "depositing") else journal.pause(id, "submissionUnknown")
        return
      }
      val bound = review.getJSONObject("deposit")
      check(
        depositAtoms(investment.assets, true) >=
          depositAtoms(bound.getString("minimumAssetsAtoms"), true) &&
          depositAtoms(investment.assets) <= invest
      )
      check(
        depositAtoms(investment.shares, true) >=
          depositAtoms(bound.getString("minimumSharesAtoms"), true)
      )
      earnHash(investment.transactionHash)
      saveAmounts(id) {
        it
          .put("phase", "invested")
          .put("depositedAtoms", investment.assets)
          .put("sharesAtoms", investment.shares)
          .put("depositTransactionHash", investment.transactionHash)
          .put("completedSteps", JSONArray(listOf("funding", "credit", "payouts", "deposit")))
      }
      engines.invested(id)
      grant?.invalidate()
      activeGrant = null
      engines.useGrant(null)
    } catch (failure: Exception) {
      if (failure is CancellationException) throw failure
      val missing = failure.message?.contains("Missing child journal") == true
      journal.pause(id, if (missing) "recoveryRequired" else "termsChanged")
      grant?.invalidate()
      activeGrant = null
      engines.useGrant(null)
    }
  }

  suspend fun reconcile(journeyId: String): Map<String, Any> {
    check(activeGrant == null) { "Read public progress while the native job owns reconciliation" }
    advance(journeyId, null)
    return journal.publicSnapshot(journeyId)
  }

  suspend fun cancel(journeyId: String, revision: Int) {
    check(journal.get(journeyId).getInt("revision") == revision)
    activeGrant?.invalidate()
    activeGrant = null
    engines.useGrant(null)
    journal.pause(journeyId, "cancelled")
  }
}
