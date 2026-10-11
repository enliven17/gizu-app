package io.gizu.storedwallet

import android.content.Context
import java.math.BigInteger
import org.json.JSONArray
import org.json.JSONObject

internal data class DepositRemainingSource(val row: JSONObject, val minimumCredit: String)

internal fun depositRemainingSourceRecord(
  original: JSONObject,
  saved: JSONObject?,
  referenced: Boolean,
): JSONObject {
  check(!referenced || saved != null) { "Missing saved source history" }
  check(saved == null || saved.getString("operationId") == original.getString("operationId"))
  return saved ?: original
}

/** Fresh unsigned economics, immutable signed children. No authority or allocation is created. */
internal class EarnDepositRemaining(
  private val journal: EarnDepositJournal,
  private val gateway: EarnDepositGateway,
  private val source: suspend (JSONObject) -> DepositRemainingSource,
  private val payout: suspend (String) -> JSONObject,
  private val receipt: (JSONObject) -> String?,
  private val reservation: () -> JSONObject,
  private val deposit: (String) -> JSONObject,
  private val now: () -> Long = System::currentTimeMillis,
) {
  suspend fun refresh(record: WalletRecord, id: String, revision: Int): JSONObject {
    val root = journal.get(id)
    check(root.getInt("revision") == revision && root.getString("phase") == "paused")
    val old = root.getJSONObject("review")
    val refs = root.getJSONObject("children")
    val depositRef = refs.optJSONArray("deposit")
    if (depositRef != null && deposit(depositRef.getString(0)).sponsoredSpendSaved()) return root
    val started = now()
    val next = JSONObject(old.toString())
    val rows = JSONArray()
    val sources = JSONArray()
    var offset = BigInteger.ZERO
    var minimumInvest = BigInteger.ZERO
    var paidInvest = BigInteger.ZERO
    var expiry = started + 45000
    for (previous in old.getJSONArray("sources").objects().sortedBy { it.getInt("accountIndex") }) {
      val sourceId = previous.getString("operationId")
      val updated =
        source(
          old.getJSONArray("fundingRows").objects().single {
            it.getString("operationId") == sourceId
          }
        )
      val p = updated.row.getJSONObject("proposal")
      val credit = depositAtoms(updated.minimumCredit, true)
      val held = (offset + credit) / BigInteger.TEN - offset / BigInteger.TEN
      val s =
        JSONObject(previous.toString())
          .put("amountAtoms", p.getString("amountAtoms"))
          .put("maximumFeeAtoms", p.getString("maximumTokenFeeAtoms"))
          .put("minimumCreditAtoms", credit.toString())
      s.put(
        "retainedAtoms",
        (depositAtoms(p.getString("budgetAtoms")) -
            depositAtoms(p.getString("amountAtoms")) -
            depositAtoms(p.getString("maximumTokenFeeAtoms")))
          .toString(),
      )
      for ((leg, input) in listOf("hold" to held, "invest" to credit - held)) {
        val child =
          refs.optJSONArray(leg)?.let { a ->
            (0 until a.length())
              .map { payout(a.getString(it)) }
              .singleOrNull { it.getJSONObject("proposal").getString("operationId") == sourceId }
          }
        val settled = child?.let(receipt)
        val bound =
          JSONObject(previous.getJSONObject(leg).toString()).put("inputAtoms", input.toString())
        if (settled != null) {
          check(child!!.getJSONObject("proposal").getString("amountAtoms") == input.toString())
          bound.put("minimumOutputAtoms", settled).put("estimatedOutputAtoms", settled)
          if (leg == "invest") paidInvest += depositAtoms(settled, true)
        } else if (child?.has("signedData") == true) {
          val fixed = child.getJSONObject("proposal")
          check(fixed.getString("amountAtoms") == input.toString())
          val minimum = depositAtoms(fixed.getString("minimumDestinationAtoms"), true)
          bound
            .put("minimumOutputAtoms", minimum.toString())
            .put(
              "estimatedOutputAtoms",
              maxOf(minimum, depositAtoms(bound.getString("estimatedOutputAtoms"))).toString(),
            )
        } else {
          val preview =
            gateway.payoutPreview(record, sourceId, p.getInt("revision"), leg, input.toString())
          bound
            .put("minimumOutputAtoms", preview.getString("minimumOutputAtoms"))
            .put("estimatedOutputAtoms", preview.getString("estimatedOutputAtoms"))
            .put("providerFeeBps", preview.getInt("providerFeeBps"))
          expiry = minOf(expiry, preview.getLong("expiresAtMs"))
        }
        s.put(leg, bound)
        if (leg == "invest")
          minimumInvest += depositAtoms(bound.getString("minimumOutputAtoms"), true)
      }
      rows.put(updated.row)
      sources.put(s)
      offset += credit
      if (!updated.row.sponsoredSpendSaved()) expiry = minOf(expiry, p.getLong("deadline") * 1000)
    }
    val preview =
      gateway.depositPreview(
        record,
        id,
        root.getInt("revision"),
        minimumInvest.toString(),
        paidInvest.toString(),
      )
    expiry = minOf(expiry, preview.getLong("expiresAtMs"))
    check(expiry > now())
    next
      .put("roleRegistry", JSONObject(record.roleRegistry))
      .put("quotedAtMs", started)
      .put("expiresAtMs", expiry)
      .put("sources", sources)
      .put("fundingRows", rows)
      .put("reservation", reservation())
      .put("policyVersion", preview.getString("policyVersion"))
    next.put(
      "deposit",
      JSONObject()
        .put("estimatedAssetsAtoms", preview.getString("depositAmount"))
        .put("minimumAssetsAtoms", preview.getString("depositAmount"))
        .put("minimumSharesAtoms", preview.getString("minimumSharesAtoms"))
        .put("shareDecimals", preview.getInt("shareDecimals"))
        .put("maximumFeeAtoms", preview.getString("depositFeeBudget"))
        .put("withdrawalReserveAtoms", preview.getString("withdrawalReserve")),
    )
    EarnDepositApproval.fromReview(record, next).invalidate()
    return journal.saveRemainingReview(id, revision, next)
  }
}

/** Only the existing native empty-intents read permission may authenticate pre-review history. */
internal fun requireDepositReadPermission(
  record: WalletRecord,
  wallet: String?,
  generation: String?,
  until: Long,
  now: Long,
) {
  check(
    record.verified &&
      record.id == wallet &&
      record.journalId == generation &&
      now in (until - 120000) until until
  ) {
    "Unlock your wallet again to reconcile saved payouts before reviewing the remaining deposit."
  }
}

internal suspend fun reconcileDepositPayoutBeforeReview(
  row: JSONObject,
  reconcile: suspend (JSONObject) -> JSONObject,
): JSONObject {
  if (!row.has("signedData") || row.getString("status") == "paid") return row
  return reconcile(row)
}

internal fun nativeDepositRemaining(
  context: Context,
  store: WalletStore,
  record: WalletRecord,
  journal: EarnDepositJournal,
  foreground: () -> Unit,
  readAuth: suspend () -> uniffi.gizu_stored_signer_core.EarnReadAuthentication,
): EarnDepositRemaining {
  val root = journal.all().single { it.getInt("cycleIndex") == record.earnCycleIndex }
  val sourceRefs = root.getJSONObject("children").optJSONArray("funding")
  val referenced =
    sourceRefs?.let { a -> (0 until a.length()).map { a.getString(it) }.toSet() } ?: emptySet()
  val reservationId = root.getJSONObject("review").getJSONObject("reservation").getString("id")
  val sponsored = earnSponsoredJournal(context, record)
  val payouts = earnPayoutJournal(context, record)
  val quotes = earnQuoteJournal(context, record)
  val rootAdapter =
    EarnDepositEngineAdapter(
      context,
      store,
      record.id,
      record.journalId,
      record.earnCycleIndex,
      foreground,
    )
  return EarnDepositRemaining(
    journal,
    EarnDepositGateway(),
    { original ->
      foreground()
      val saved =
        sponsored
          .all()
          .singleOrNull { it.getString("operationId") == original.getString("operationId") }
          ?.let {
            rootAdapter.reconcileBeforeRemaining("funding", it.getString("operationId"), readAuth)
          }
      var current =
        depositRemainingSourceRecord(
          original,
          saved,
          original.getString("operationId") in referenced,
        )
      val credited = if (saved != null) rootAdapter.credit(saved) else null
      if (!current.sponsoredSpendSaved()) {
        check(
          !current.optBoolean("cancelled") &&
            !current.optBoolean("signingPending") &&
            !current.optBoolean("conflict")
        )
        val pair = EarnSourceReplanner(quotes).replan(record, current)
        current =
          if (saved != null)
            sponsored.refreshUnsignedSource(
              saved.getString("operationId"),
              saved.getInt("revision"),
              pair.first,
              pair.second,
            )
          else
            JSONObject(current.toString())
              .put("proposal", pair.first)
              .put("unsignedUserOperation", pair.second)
      }
      val p = current.getJSONObject("proposal")
      val minimum =
        credited
          ?: quotes
            .get(current.getString("operationId"), p.getInt("revision"))
            ?.getString("minimumCreditAtoms")
          ?: error("Missing source credit proof")
      DepositRemainingSource(current, minimum)
    },
    { id -> rootAdapter.reconcileBeforeRemaining("payouts", id, readAuth) },
    rootAdapter::payoutReceipt,
    { fundingReservations(context, record).batch(reservationId) },
    sponsored::get,
  )
}
