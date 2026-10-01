package io.gizu.storedwallet.portfolio

import android.content.Context
import io.gizu.storedwallet.*
import java.math.BigInteger
import java.security.MessageDigest
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.deriveAccountAddresses
import uniffi.gizu_stored_signer_core.deriveEarnCycleConfidentialAddress

/** Native only: never return targets, read signatures, or catalogue rows through Expo. */
internal data class NativeConfidentialTarget(
  val walletId: String,
  val generation: String,
  val address: String,
  val kind: String,
  val profileChainId: Int,
  val cycleIndex: Int,
)

/** Cached aggregate observations are not evidence of settlement and cannot authorize funding. */
internal class NativeOwnedConfidentialPortfolio(
  private val file: (String) -> WalletFile,
  private val key: () -> SecretKey,
  private val deriveSwap: (WalletRecord) -> String,
  private val deriveEarn: (WalletRecord, Int, Int) -> String,
  private val clock: () -> Long = System::currentTimeMillis,
) {
  constructor(
    context: Context
  ) : this(
    file = { AndroidWalletFile(context, it, limit = 512 * 1024) },
    key = { checkNotNull(AndroidWalletKeys().existing()) },
    deriveSwap = { deriveAccountAddresses(it.entropy)[2] },
    deriveEarn = { record, chain, cycle ->
      deriveEarnCycleConfidentialAddress(record.entropy, chain.toULong(), cycle.toUInt())
    },
  )

  private fun aad(wallet: String, generation: String) =
    "gizu-owned-confidential:v1:$wallet:$generation".toByteArray()

  private fun load(wallet: String, generation: String): JSONObject {
    val stored = file("gizu-owned-confidential-$generation.enc")
    if (!stored.exists()) return JSONObject().put("version", 1).put("observations", JSONObject())
    val clear = CryptoEnvelope.decrypt(key(), stored.read(), aad(wallet, generation))
    try {
      return JSONObject(String(clear, Charsets.UTF_8)).also { check(it.getInt("version") == 1) }
    } finally {
      clear.fill(0)
    }
  }

  private fun save(wallet: String, generation: String, root: JSONObject) {
    val clear = root.toString().toByteArray()
    require(clear.size < 512 * 1024)
    try {
      file("gizu-owned-confidential-$generation.enc")
        .write(CryptoEnvelope.encrypt(key(), clear, aad(wallet, generation)))
    } finally {
      clear.fill(0)
    }
  }

  private fun fresh(timestamp: Long, now: Long) = now - timestamp in -5_000L until 30_000L

  private fun targets(record: WalletRecord, root: JSONObject): List<NativeConfidentialTarget> {
    val cycles = JSONArray(record.earnCycles)
    val rows = (0 until cycles.length()).map { cycles.getJSONObject(it) }.toMutableList()
    if (rows.isEmpty() && record.earnChain > 0)
      rows.add(JSONObject().put("chainId", record.earnChain).put("cycleIndex", 0))
    val descriptor = rows.joinToString("|") { "${it.getInt("chainId")}:${it.getInt("cycleIndex")}" }
    val fingerprint =
      MessageDigest.getInstance("SHA-256").digest(descriptor.toByteArray()).joinToString("") {
        "%02x".format(it)
      }
    if (root.optString("catalogue") != fingerprint) {
      val all =
        listOf(
          NativeConfidentialTarget(
            record.id,
            record.journalId,
            deriveSwap(record).lowercase(),
            "swap",
            0,
            0,
          )
        ) +
          rows.map { row ->
            val chain = row.getInt("chainId")
            val cycle = row.getInt("cycleIndex")
            NativeConfidentialTarget(
              record.id,
              record.journalId,
              deriveEarn(record, chain, cycle).lowercase(),
              "earn",
              chain,
              cycle,
            )
          }
      require(
        all.size <= 257 &&
          all.map { it.address }.distinct().size == all.size &&
          all.all { it.address.matches(Regex("0x[0-9a-f]{40}")) }
      )
      root
        .put("catalogue", fingerprint)
        .put(
          "targets",
          JSONArray(
            all.map {
              JSONObject()
                .put("address", it.address)
                .put("kind", it.kind)
                .put("profileChainId", it.profileChainId)
                .put("cycleIndex", it.cycleIndex)
            }
          ),
        )
    }
    val saved = root.getJSONArray("targets")
    require(saved.length() in 1..257)
    return (0 until saved.length()).map { index ->
      val row = saved.getJSONObject(index)
      NativeConfidentialTarget(
        record.id,
        record.journalId,
        row.getString("address"),
        row.getString("kind"),
        row.getInt("profileChainId"),
        row.getInt("cycleIndex"),
      )
    }
  }

  fun nextTargets(
    record: WalletRecord,
    now: Long = clock(),
    max: Int = 4,
  ): List<NativeConfidentialTarget> {
    require(max in 1..4)
    val root = load(record.id, record.journalId)
    val all = targets(record, root)
    val observations = root.getJSONObject("observations")
    val offset = root.optInt("offset", 0).mod(all.size)
    val rotating = all.drop(offset) + all.take(offset)
    val current =
      all.firstOrNull {
        it.kind == "earn" &&
          it.profileChainId == record.earnChain &&
          it.cycleIndex == record.earnCycleIndex
      }
    val priority = listOfNotNull(current, all.firstOrNull { it.kind == "swap" })
    val selected =
      (priority + rotating)
        .distinct()
        .filter { target ->
          !observations.has(target.address) ||
            !fresh(observations.getJSONObject(target.address).getLong("timestampMs"), now)
        }
        .take(max)
    // Skip fresh priority rows; the persisted cursor still gives historical accounts fair progress.
    selected.lastOrNull()?.let { root.put("offset", (all.indexOf(it) + 1) % all.size) }
    save(record.id, record.journalId, root)
    return selected
  }

  fun recordValidated(
    target: NativeConfidentialTarget,
    observation: Map<String, Any>,
    now: Long = clock(),
  ) {
    val root = load(target.walletId, target.generation)
    val rows = root.getJSONArray("targets")
    require(
      (0 until rows.length()).any { index ->
        val row = rows.getJSONObject(index)
        row.getString("address") == target.address &&
          row.getString("kind") == target.kind &&
          row.getInt("profileChainId") == target.profileChainId &&
          row.getInt("cycleIndex") == target.cycleIndex
      }
    )
    // Reuse the native transport parser: exact C, canonical asset, timestamp, unsigned atoms and
    // authenticated non-operation-scoped observation are required before any cache write.
    val validated =
      ConfidentialBalance.publicBalance(JSONObject(observation).toString(), target.address, now)
    root
      .getJSONObject("observations")
      .put(
        target.address,
        JSONObject()
          .put("available", validated.getValue("available"))
          .put("timestampMs", validated.getValue("timestampMs")),
      )
    save(target.walletId, target.generation, root)
  }

  fun snapshot(record: WalletRecord, now: Long = clock()): Map<String, Any?> {
    val root = load(record.id, record.journalId)
    val all = targets(record, root)
    val observations = root.getJSONObject("observations")
    val known = all.mapNotNull { observations.optJSONObject(it.address) }
    val observed =
      known
        .fold(BigInteger.ZERO) { sum, row -> sum + BigInteger(row.getString("available")) }
        .toString()
    val complete = known.size == all.size && known.all { fresh(it.getLong("timestampMs"), now) }
    val checked = known.minOfOrNull { it.getLong("timestampMs") } ?: 0L
    val row =
      mapOf<String, Any?>(
        "assetId" to ASSET,
        "chainId" to 143,
        "token" to "confidential:monad-usdc",
        "symbol" to "USDC (private)",
        "decimals" to 6,
        "observedAtoms" to observed,
        "balanceAtoms" to observed.takeIf { complete },
        "valueUsdcAtoms" to observed.takeIf { complete },
        "valuationUnavailable" to !complete,
        "complete" to complete,
        "stale" to !complete,
        "checkedAt" to checked,
      )
    save(record.id, record.journalId, root)
    return mapOf(
      "ownedAssets" to listOf(row),
      "confidentialKnownAtoms" to observed,
      "confidentialComplete" to complete,
      "confidentialStale" to !complete,
      "confidentialSyncPending" to !complete,
      "confidentialReadRequired" to !complete,
      "confidentialCheckedAt" to checked,
    )
  }

  companion object {
    private const val ASSET = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx"
  }
}
