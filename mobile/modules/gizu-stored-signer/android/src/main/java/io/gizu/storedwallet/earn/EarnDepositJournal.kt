package io.gizu.storedwallet

import android.content.Context
import java.util.UUID
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject

internal fun earnDepositJournal(context: Context, record: WalletRecord) =
  EarnDepositJournal(
    AndroidWalletFile(context, "gizu-earn-deposit-${record.journalId}.enc", 4 * 1024 * 1024),
    { checkNotNull(AndroidWalletKeys().existing()) },
    record.id,
    record.journalId,
  )

/**
 * Atomic encrypted identities and progress; signing evidence remains in the existing child
 * journals.
 */
internal class EarnDepositJournal(
  private val file: WalletFile,
  private val key: () -> SecretKey,
  private val walletId: String,
  private val generation: String,
) {
  private val aad = "gizu-earn-deposit:v1:$walletId:$generation".toByteArray()

  companion object {
    private val lock = Any()
  }

  fun all(): List<JSONObject> =
    synchronized(lock) {
      if (!file.exists()) return@synchronized emptyList()
      val clear = CryptoEnvelope.decrypt(key(), file.read(), aad)
      try {
        val root = JSONObject(String(clear, Charsets.UTF_8))
        check(
          root.getInt("version") == 1 &&
            root.getString("walletId") == walletId &&
            root.getString("generation") == generation
        )
        root.getJSONArray("journeys").objects().also { rows ->
          check(
            rows.size <= 256 && rows.map { it.getString("journeyId") }.distinct().size == rows.size
          )
          rows.forEach {
            check(
              it.getString("walletId") == walletId &&
                it.getString("generation") == generation &&
                it.getInt("revision") > 0
            )
          }
        }
      } finally {
        clear.fill(0)
      }
    }

  private fun write(rows: List<JSONObject>) {
    val clear =
      JSONObject()
        .put("version", 1)
        .put("walletId", walletId)
        .put("generation", generation)
        .put("journeys", JSONArray(rows))
        .toString()
        .toByteArray()
    try {
      check(clear.size <= 3 * 1024 * 1024)
      file.write(CryptoEnvelope.encrypt(key(), clear, aad))
    } finally {
      clear.fill(0)
    }
  }

  fun get(id: String): JSONObject = all().single { it.getString("journeyId") == id }

  fun loadOrCreate(record: WalletRecord, profile: Int, draftId: String?): JSONObject =
    synchronized(lock) {
      check(
        record.id == walletId &&
          record.journalId == generation &&
          record.verified &&
          !record.earnRecoveryRequired &&
          profile == 4663 &&
          record.earnChain == profile
      )
      val rows = all()
      val existing =
        if (draftId != null) rows.single { it.getString("journeyId") == draftId }
        else rows.singleOrNull { it.getInt("cycleIndex") == record.earnCycleIndex }
      if (existing != null) {
        check(
          existing.getInt("cycleIndex") == record.earnCycleIndex &&
            existing.getInt("profileChainId") == profile
        )
        return@synchronized existing
      }
      check(rows.size < 256)
      val id = "deposit_" + UUID.randomUUID().toString().replace("-", "")
      val row =
        JSONObject()
          .put("version", 1)
          .put("journeyId", id)
          .put("revision", 1)
          .put("walletId", walletId)
          .put("generation", generation)
          .put("cycleIndex", record.earnCycleIndex)
          .put("intentId", "earn_${record.id}_${record.earnCycleIndex}")
          .put("profileChainId", profile)
          .put("profileId", "robinhood-usdg")
          .put("phase", "draft")
          .put("budgetAtoms", "0")
          .put(
            "destinations",
            JSONArray(
              cycleAddresses(record).mapIndexed { n, address ->
                JSONObject()
                  .put("role", if (n == 0) "hold" else "invest")
                  .put("chainId", profile)
                  .put("address", address)
              }
            ),
          )
          .put("children", JSONObject())
          .put("completedSteps", JSONArray())
      for (field in
        listOf(
          "creditedAtoms",
          "holdReceivedAtoms",
          "investReceivedAtoms",
          "depositedAtoms",
          "sharesAtoms",
        )) row.put(field, "0")
      write(rows + row)
      row
    }

  fun update(id: String, revision: Int, action: (JSONObject) -> Unit): JSONObject =
    synchronized(lock) {
      val rows = all()
      val row = rows.single { it.getString("journeyId") == id }
      check(row.getInt("revision") == revision) { "Stale deposit journey" }
      action(row)
      row.put("revision", Math.addExact(revision, 1))
      write(rows)
      row
    }

  fun saveReview(id: String, revision: Int, review: JSONObject): JSONObject =
    update(id, revision) { row ->
      check(row.getJSONObject("children").length() == 0) {
        "Reconcile saved children before replacing the review"
      }
      check(
        review.getString("journeyId") == id &&
          review.getString("walletId") == walletId &&
          review.getString("generation") == generation
      )
      check(review.getInt("cycleIndex") == row.getInt("cycleIndex"))
      row.put("budgetAtoms", depositAtoms(review.getString("sourceBudgetAtoms"), true).toString())
      row.put("review", JSONObject(review.toString())).put("phase", "review")
      row.remove("pauseReason")
      row.remove("message")
    }

  fun attachChild(id: String, revision: Int, stage: String, childId: String): JSONObject =
    update(id, revision) { row ->
      check(
        stage in setOf("funding", "hold", "invest", "deposit") &&
          childId.matches(Regex("[-a-zA-Z0-9_]{1,128}"))
      )
      val children = row.getJSONObject("children")
      check(
        children.keys().asSequence().none { name ->
          children.getJSONArray(name).let { a ->
            (0 until a.length()).any { a.getString(it) == childId }
          }
        }
      )
      val list = children.optJSONArray(stage) ?: JSONArray()
      check(list.length() < if (stage == "deposit") 1 else 256)
      list.put(childId)
      children.put(stage, list)
    }

  fun pause(id: String, reason: String, message: String? = null): JSONObject {
    check(reason in depositPauseReasons)
    val row = get(id)
    return update(id, row.getInt("revision")) {
      if (it.getString("phase") != "invested") {
        it.put("phase", "paused").put("pauseReason", reason)
        if (message != null) it.put("message", message.take(1024))
      }
    }
  }

  fun publicSnapshot(id: String): Map<String, Any> {
    val row = get(id)
    val public = JSONObject()
    for (field in
      listOf(
        "version",
        "journeyId",
        "revision",
        "walletId",
        "intentId",
        "profileId",
        "phase",
        "destinations",
        "budgetAtoms",
        "creditedAtoms",
        "holdReceivedAtoms",
        "investReceivedAtoms",
        "depositedAtoms",
        "sharesAtoms",
        "completedSteps",
        "pauseReason",
        "message",
        "depositTransactionHash",
      )) if (row.has(field)) public.put(field, row.get(field))
    row.optJSONObject("review")?.let { public.put("review", depositPublicReview(it)) }
    return depositJsonMap(public)
  }
}

private val depositPauseReasons =
  setOf(
    "quoteUnavailable",
    "previewUnavailable",
    "insufficientFunds",
    "uneconomicAmount",
    "termsChanged",
    "approvalExpired",
    "settlementPending",
    "submissionUnknown",
    "recoveryRequired",
    "unsupportedCapability",
    "cancelled",
  )

internal fun depositPublicReview(review: JSONObject): JSONObject {
  fun pick(row: JSONObject, fields: List<String>) =
    JSONObject().also { out -> fields.forEach { out.put(it, row.get(it)) } }
  val out = pick(review, listOf("policyVersion", "quotedAtMs", "expiresAtMs", "sourceBudgetAtoms"))
  out.put(
    "sources",
    JSONArray(
      review.getJSONArray("sources").objects().map { s ->
        pick(
            s,
            listOf(
              "operationId",
              "accountIndex",
              "address",
              "budgetAtoms",
              "amountAtoms",
              "maximumFeeAtoms",
              "retainedAtoms",
              "minimumCreditAtoms",
            ),
          )
          .also {
            for (leg in listOf("hold", "invest")) it.put(
              leg,
              pick(
                s.getJSONObject(leg),
                listOf(
                  "recipient",
                  "inputAtoms",
                  "estimatedOutputAtoms",
                  "minimumOutputAtoms",
                  "providerFeeBps",
                ),
              ),
            )
          }
      }
    ),
  )
  out.put(
    "deposit",
    pick(
      review.getJSONObject("deposit"),
      listOf(
        "estimatedAssetsAtoms",
        "minimumAssetsAtoms",
        "minimumSharesAtoms",
        "maximumFeeAtoms",
        "withdrawalReserveAtoms",
      ),
    ),
  )
  return out
}

internal fun depositJsonMap(json: JSONObject): Map<String, Any> =
  json.keys().asSequence().associateWith { key -> depositJsonValue(json.get(key)) }

private fun depositJsonValue(value: Any): Any =
  when (value) {
    is JSONObject -> depositJsonMap(value)
    is JSONArray -> (0 until value.length()).map { depositJsonValue(value.get(it)) }
    else -> value
  }
