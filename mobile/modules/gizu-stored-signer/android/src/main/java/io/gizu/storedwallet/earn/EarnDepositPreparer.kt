package io.gizu.storedwallet

import android.content.Context
import java.math.BigInteger
import java.util.UUID
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

internal data class DepositSourceDraft(
  val rows: List<JSONObject>,
  val reservation: JSONObject,
  val minimumCredits: Map<String, String>,
)

internal fun nativeDepositPreparer(
  context: Context,
  record: WalletRecord,
  journal: EarnDepositJournal,
) =
  EarnDepositPreparer(
    journal,
    EarnDepositGateway(),
    { current, budget ->
      val plan = JSONObject(NativeFundingPlanner(context, current).plan(budget))
      val ledger = fundingReservations(context, current)
      val batchId = plan.getString("fundingBatchId")
      try {
        val journey = journal.all().single { it.getInt("cycleIndex") == current.earnCycleIndex }
        journal.bindPreparationReservation(
          journey.getString("journeyId"),
          journey.getInt("revision"),
          batchId,
        )
        val quotes = earnQuoteJournal(context, current)
        val replan = EarnSourceReplanner(quotes)
        val credits = linkedMapOf<String, String>()
        val rows =
          plan.getJSONArray("legs").objects().map { leg ->
            val id = "source_" + UUID.randomUUID().toString().replace("-", "")
            val index = leg.getInt("sourceIndex")
            val owner = publicAccountAddress(current, index)
            ledger.bind(batchId, owner, id, leg.getString("budgetAtoms"))
            val original =
              JSONObject()
                .put("walletId", current.id)
                .put("operationId", id)
                .put("revision", 1)
                .put("status", "planned")
                .put(
                  "proposal",
                  JSONObject()
                    .put("kind", "sourceFunding")
                    .put("operationId", id)
                    .put("revision", 1)
                    .put("chainId", 143)
                    .put("profileChainId", 4663)
                    .put("cycleIndex", current.earnCycleIndex)
                    .put("sourceAccountIndex", index)
                    .put("fundingBatchId", batchId)
                    .put("fundingBatchSize", plan.getInt("fundingBatchSize"))
                    .put("expectedFrom", owner)
                    .put("refundOwner", owner)
                    .put("confidentialAccount", cycleConfidential(current))
                    .put("token", MONAD_EARN_USDC)
                    .put("recipient", cycleConfidential(current))
                    .put("nonce", "0x0")
                    .put("budgetAtoms", leg.getString("budgetAtoms"))
                    .put("amountAtoms", "1")
                    .put("maximumTokenFeeAtoms", "1")
                    .put("withdrawalReserveAtoms", "10000")
                    .put("slippageBps", 0)
                    .put("deadline", System.currentTimeMillis() / 1000 + 180),
                )
            val (p, unsigned) = replan.replan(current, original)
            val quote = checkNotNull(quotes.get(id, p.getInt("revision")))
            credits[id] = quote.getString("minimumCreditAtoms")
            original.put("proposal", p).put("unsignedUserOperation", unsigned)
          }
        ledger.commitBatch(batchId)
        DepositSourceDraft(rows, ledger.batch(batchId), credits)
      } catch (failure: Exception) {
        ledger.cancelBatchUnsigned(batchId)
        throw failure
      }
    },
    { review ->
      fundingReservations(context, record)
        .cancelBatchUnsigned(review.getJSONObject("reservation").getString("id"))
    },
  )

/** Allocation is performed once by the native owner before this unsigned preparation. */
internal class EarnDepositPreparer(
  private val journal: EarnDepositJournal,
  private val gateway: EarnDepositGateway,
  private val selectSources: suspend (WalletRecord, String) -> DepositSourceDraft,
  private val releaseUnsigned: (JSONObject) -> Unit,
  private val now: () -> Long = System::currentTimeMillis,
) {
  suspend fun prepare(
    record: WalletRecord,
    profile: Int,
    budgetAtoms: String,
    draftId: String?,
  ): JSONObject {
    check(profile == 4663 && record.earnChain == 4663)
    depositAtoms(budgetAtoms, true)
    var row = journal.loadOrCreate(record, profile, draftId)
    val id = row.getString("journeyId")
    check(row.getJSONObject("children").length() == 0) {
      "Reconcile the existing deposit before preparing another amount"
    }
    row =
      journal.cancelUnsignedReview(id) { batchId ->
        releaseUnsigned(JSONObject().put("reservation", JSONObject().put("id", batchId)))
      }
    row =
      journal.update(id, row.getInt("revision")) {
        it.put("phase", "preparing").put("budgetAtoms", budgetAtoms)
        it.remove("review")
        it.remove("pauseReason")
      }
    var draft: DepositSourceDraft? = null
    try {
      val started = now()
      draft = selectSources(record, budgetAtoms)
      row = journal.get(id)
      check(row.getString("phase") == "preparing" && row.getJSONObject("children").length() == 0)
      check(row.getString("budgetAtoms") == budgetAtoms)
      check(draft.rows.isNotEmpty())
      val sources = JSONArray()
      var offset = BigInteger.ZERO
      var minimumInvest = BigInteger.ZERO
      var expiry = started + 45000
      for (child in
        draft.rows.sortedBy { it.getJSONObject("proposal").getInt("sourceAccountIndex") }) {
        val p = child.getJSONObject("proposal")
        val sourceId = child.getString("operationId")
        val credit = depositAtoms(checkNotNull(draft.minimumCredits[sourceId]), true)
        val hold = (offset + credit) / BigInteger.TEN - offset / BigInteger.TEN
        val invest = credit - hold
        val s =
          JSONObject()
            .put("operationId", sourceId)
            .put("accountIndex", p.getInt("sourceAccountIndex"))
            .put("address", p.getString("expectedFrom"))
            .put("budgetAtoms", p.getString("budgetAtoms"))
            .put("amountAtoms", p.getString("amountAtoms"))
            .put("maximumFeeAtoms", p.getString("maximumTokenFeeAtoms"))
            .put("minimumCreditAtoms", credit.toString())
            .put(
              "retainedAtoms",
              (depositAtoms(p.getString("budgetAtoms")) -
                  depositAtoms(p.getString("amountAtoms")) -
                  depositAtoms(p.getString("maximumTokenFeeAtoms")))
                .toString(),
            )
        for ((leg, amount) in listOf("hold" to hold, "invest" to invest)) {
          val preview =
            gateway.payoutPreview(record, sourceId, p.getInt("revision"), leg, amount.toString())
          s.put(
            leg,
            JSONObject()
              .put("recipient", preview.getString("recipient"))
              .put("inputAtoms", amount.toString())
              .put("estimatedOutputAtoms", preview.getString("estimatedOutputAtoms"))
              .put("minimumOutputAtoms", preview.getString("minimumOutputAtoms"))
              .put("providerFeeBps", preview.getInt("providerFeeBps")),
          )
          expiry = minOf(expiry, preview.getLong("expiresAtMs"))
          if (leg == "invest")
            minimumInvest += depositAtoms(preview.getString("minimumOutputAtoms"), true)
        }
        expiry = minOf(expiry, Math.multiplyExact(p.getLong("deadline"), 1000))
        sources.put(s)
        offset += credit
      }
      // Establish the deposit bound against minimum receipts, not optimistic output estimates.
      val deposit =
        gateway.depositPreview(record, id, row.getInt("revision"), minimumInvest.toString())
      expiry = minOf(expiry, deposit.getLong("expiresAtMs"))
      check(expiry > now()) { "Deposit preview expired during preparation" }
      val review =
        JSONObject()
          .put("walletId", record.id)
          .put("generation", record.journalId)
          .put("cycleIndex", record.earnCycleIndex)
          .put("roleRegistry", JSONObject(record.roleRegistry))
          .put("profileChainId", profile)
          .put("confidentialAccount", cycleConfidential(record))
          .put("journeyId", id)
          .put("destinations", JSONArray(cycleAddresses(record)))
          .put("policyVersion", deposit.getString("policyVersion"))
          .put("quotedAtMs", started)
          .put("expiresAtMs", expiry)
          .put("sourceBudgetAtoms", budgetAtoms)
          .put("sources", sources)
          .put("fundingRows", JSONArray(draft.rows))
          .put("reservation", draft.reservation)
          .put(
            "deposit",
            JSONObject()
              .put("estimatedAssetsAtoms", deposit.getString("depositAmount"))
              .put("minimumAssetsAtoms", deposit.getString("depositAmount"))
              .put("minimumSharesAtoms", deposit.getString("minimumSharesAtoms"))
              .put("shareDecimals", deposit.getInt("shareDecimals"))
              .put("maximumFeeAtoms", deposit.getString("depositFeeBudget"))
              .put("withdrawalReserveAtoms", deposit.getString("withdrawalReserve")),
          )
      EarnDepositApproval.fromReview(record, review).invalidate()
      return journal.saveReview(id, row.getInt("revision"), review)
    } catch (failure: Exception) {
      val saved = journal.get(id)
      if (!saved.has("preparationBatchId") && draft != null)
        releaseUnsigned(JSONObject().put("reservation", draft.reservation))
      journal.cancelUnsignedReview(id) { batchId ->
        releaseUnsigned(JSONObject().put("reservation", JSONObject().put("id", batchId)))
      }
      journal.pause(id, "previewUnavailable")
      if (failure is CancellationException) throw failure
      return journal.get(id)
    }
  }
}
