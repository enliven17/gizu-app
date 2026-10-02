package io.gizu.storedwallet

import java.io.*
import java.util.UUID
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject

internal const val INITIAL_ROLE_REGISTRY = """{"version":1,"nextRecipient":3}"""

internal fun requireRoleRegistry(value: String) {
  require(value.length in 1..1024)
  val p = JSONObject(value)
  require(p.length() == 2 && p.getInt("version") == 1 && p.getInt("nextRecipient") >= 3)
}

/** Secrets and the account catalogue never leave native encrypted storage. */
internal class WalletRecord(
  val id: String,
  val credential: StoredPasskey,
  val entropy: ByteArray,
  val verified: Boolean = false,
  val journalId: String = id,
  val roleRegistry: String = INITIAL_ROLE_REGISTRY,
  val earnChain: Int = 0,
  val earnRecoveryRequired: Boolean = false,
  val earnCycleIndex: Int = 0,
  val earnCycles: String = "[]",
) : AutoCloseable {
  init {
    UUID.fromString(id)
    UUID.fromString(journalId)
    require(entropy.size == 32 && credential.credentialId.size in 1..1024)
    require(credential.publicKeyX.size == 32 && credential.publicKeyY.size == 32)
    requireRoleRegistry(roleRegistry)
    require(earnChain in listOf(0, 1, 4663) && earnCycleIndex in 0..1_000_000)
    val rows = JSONArray(earnCycles)
    require(rows.length() <= 256 && earnCycles.length <= 48_000)
    val seen = mutableSetOf<Int>()
    for (i in 0 until rows.length()) {
      val row = rows.getJSONObject(i)
      require(row.getInt("cycleIndex") in 0..1_000_000 && seen.add(row.getInt("cycleIndex")))
      require(row.getInt("chainId") in listOf(1, 4663))
      if (row.has("withdrawalIndex"))
        require(
          row.getInt("withdrawalIndex") in 3 until JSONObject(roleRegistry).getInt("nextRecipient")
        )
    }
  }

  override fun close() {
    entropy.fill(0)
  }

  fun publicState(): Map<String, Any> =
    mapOf("status" to if (verified) "ready" else "backupRequired", "walletId" to id)
}

internal interface WalletFile {
  fun exists(): Boolean

  fun read(): ByteArray

  fun write(bytes: ByteArray)
}

internal interface WalletKeys {
  fun existing(): SecretKey?

  fun create(): SecretKey

  fun reset(): SecretKey
}

internal class WalletStore(private val file: WalletFile, private val keys: WalletKeys) {
  private val aad = "io.gizu.storedwallet.v1:wallet:gizu.io:gizu-stored-evm-v1".toByteArray()
  private val lock = Any()

  fun exists() = file.exists()

  fun state(): Map<String, Any> =
    try {
      if (!exists()) mapOf("status" to "absent") else load().use { it.publicState() }
    } catch (_: Exception) {
      mapOf("status" to "recoveryRequired")
    }

  fun load(): WalletRecord {
    check(exists())
    // Never generate a new key when existing data cannot be decrypted.
    val key = keys.existing() ?: throw WalletException(WalletErrorCode.RECOVERY_REQUIRED)
    val encrypted = file.read()
    require(encrypted.size in 1..65536)
    val clear = CryptoEnvelope.decrypt(key, encrypted, aad)
    try {
      val version = DataInputStream(ByteArrayInputStream(clear)).readInt()
      require(version in 1..5)
      // Two released development branches used version 4 for different layouts.
      // Validate the entire record before accepting either historical encoding.
      if (version == 4) {
        try {
          return decode(clear, false)
        } catch (_: Exception) {
          return decode(clear, true)
        }
      }
      return decode(clear, version >= 5)
    } finally {
      clear.fill(0)
    }
  }

  private fun decode(clear: ByteArray, earnLayout: Boolean): WalletRecord =
    DataInputStream(ByteArrayInputStream(clear)).use { input ->
      val v = input.readInt()
      val verified = if (v >= 2) input.readBoolean() else false
      val id = input.readUTF()
      val generation = if (v >= 3) input.readUTF() else id
      val chain = if (earnLayout) input.readInt() else 0
      val recovery = if (earnLayout) input.readBoolean() else false
      val length = input.readInt()
      require(length in 1..1024)
      val credential =
        StoredPasskey(
          ByteArray(length).also(input::readFully),
          ByteArray(32).also(input::readFully),
          ByteArray(32).also(input::readFully),
        )
      val entropy = ByteArray(32)
      try {
        input.readFully(entropy)
        val registry =
          if (v >= 5 || v == 4 && !earnLayout) input.readUTF() else INITIAL_ROLE_REGISTRY
        val cycle = if (v >= 5) input.readInt() else 0
        val cycles =
          if (v >= 5) input.readUTF()
          else if (chain > 0) JSONArray().put(cycleRow(id, 0, chain)).toString() else "[]"
        require(input.available() == 0)
        WalletRecord(
          id,
          credential,
          entropy,
          verified,
          generation,
          registry,
          chain,
          recovery,
          cycle,
          cycles,
        )
      } catch (e: Exception) {
        entropy.fill(0)
        throw e
      }
    }

  fun create(record: WalletRecord) =
    synchronized(lock) {
      check(!exists()) { "Existing wallet must not be overwritten" }
      save(record)
    }

  private fun replacement(
    current: WalletRecord,
    verified: Boolean = current.verified,
    registry: String = current.roleRegistry,
    chain: Int = current.earnChain,
    recovery: Boolean = current.earnRecoveryRequired,
    cycle: Int = current.earnCycleIndex,
    cycles: String = current.earnCycles,
  ) =
    WalletRecord(
      current.id,
      current.credential,
      current.entropy.copyOf(),
      verified,
      current.journalId,
      registry,
      chain,
      recovery,
      cycle,
      cycles,
    )

  private fun checkIdentity(current: WalletRecord, expected: WalletRecord) {
    check(
      current.id == expected.id &&
        current.journalId == expected.journalId &&
        java.security.MessageDigest.isEqual(current.entropy, expected.entropy)
    )
    check(current.credential.credentialId.contentEquals(expected.credential.credentialId))
  }

  fun markVerified(expected: WalletRecord) =
    synchronized(lock) {
      load().use { current ->
        checkIdentity(current, expected)
        replacement(current, verified = true).use { save(it) }
      }
    }

  /** Legacy intent 0 is recovered unchanged; allocating another investment is explicit. */
  fun bindEarnChain(expected: WalletRecord, chain: Int) =
    synchronized(lock) {
      require(chain in listOf(1, 4663))
      load().use { current ->
        checkIdentity(current, expected)
        check(current.verified && expected.verified)
        check(current.earnChain == 0 || current.earnChain == chain || current.earnRecoveryRequired)
        if (current.earnChain == chain) return@synchronized
        val rows = JSONArray(current.earnCycles)
        if (rows.length() == 0) rows.put(cycleRow(current.id, 0, chain))
        else if (current.earnRecoveryRequired)
          for (i in 0 until rows.length()) if (
            rows.getJSONObject(i).getInt("cycleIndex") == current.earnCycleIndex
          )
            rows.getJSONObject(i).put("chainId", chain)
        replacement(current, chain = chain, cycles = rows.toString()).use { save(it) }
      }
    }

  fun allocateEarnCycle(expected: WalletRecord, chain: Int) =
    synchronized(lock) {
      require(chain in listOf(1, 4663))
      load().use { current ->
        checkIdentity(current, expected)
        check(current.verified && !current.earnRecoveryRequired)
        val rows = JSONArray(current.earnCycles)
        check(rows.length() < 256)
        if (rows.length() == 0 && current.earnChain > 0)
          rows.put(cycleRow(current.id, 0, current.earnChain))
        val next =
          (0 until rows.length())
            .maxOfOrNull { rows.getJSONObject(it).getInt("cycleIndex") }
            ?.plus(1) ?: 1
        rows.put(cycleRow(current.id, next, chain))
        replacement(current, chain = chain, cycle = next, cycles = rows.toString()).use { save(it) }
      }
    }

  fun selectEarnCycle(index: Int) =
    synchronized(lock) {
      load().use { current ->
        val rows = JSONArray(current.earnCycles)
        val row =
          (0 until rows.length()).map(rows::getJSONObject).single {
            it.getInt("cycleIndex") == index
          }
        replacement(current, chain = row.getInt("chainId"), cycle = index).use { save(it) }
      }
    }

  /** A retry keeps its receiver. Different cycles can never consolidate into one receiver. */
  fun reserveEarnWithdrawal(expected: WalletRecord): Int =
    synchronized(lock) {
      load().use { current ->
        checkIdentity(current, expected)
        check(current.verified && !current.earnRecoveryRequired)
        val rows = JSONArray(current.earnCycles)
        if (rows.length() == 0) rows.put(cycleRow(current.id, 0, current.earnChain))
        val row =
          (0 until rows.length()).map(rows::getJSONObject).single {
            it.getInt("cycleIndex") == current.earnCycleIndex
          }
        if (row.has("withdrawalIndex")) return@synchronized row.getInt("withdrawalIndex")
        val registry = JSONObject(current.roleRegistry)
        val index = registry.getInt("nextRecipient")
        check(index < Int.MAX_VALUE)
        registry.put("nextRecipient", index + 1)
        row.put("withdrawalIndex", index)
        replacement(current, registry = registry.toString(), cycles = rows.toString()).use {
          save(it)
        }
        index
      }
    }

  fun restore(record: WalletRecord) =
    synchronized(lock) {
      check(state()["status"] in listOf("absent", "recoveryRequired"))
      val key = keys.reset()
      WalletRecord(
          record.id,
          record.credential,
          record.entropy.copyOf(),
          true,
          UUID.randomUUID().toString(),
          record.roleRegistry,
          record.earnChain,
          true,
          record.earnCycleIndex,
          record.earnCycles,
        )
        .use { save(it, key) }
    }

  fun persistRegistry(expectedId: String, registry: String) =
    synchronized(lock) {
      requireRoleRegistry(registry)
      load().use { current ->
        check(
          current.id == expectedId &&
            JSONObject(registry).getInt("nextRecipient") >=
              JSONObject(current.roleRegistry).getInt("nextRecipient")
        )
        replacement(current, registry = registry).use { save(it) }
      }
    }

  private fun cycleRow(id: String, index: Int, chain: Int): JSONObject {
    val profile = if (chain == 1) "ethereum-usdc" else "robinhood-usdg"
    return JSONObject()
      .put("cycleIndex", index)
      .put("chainId", chain)
      .put(
        "intentId",
        if (index == 0) "earn-v1:${id.lowercase()}:$profile"
        else "earn-v2:${id.lowercase()}:$profile:$index",
      )
  }

  private fun save(record: WalletRecord, key: SecretKey? = null) {
    val header =
      ByteArrayOutputStream()
        .apply {
          DataOutputStream(this).use { out ->
            out.writeInt(5)
            out.writeBoolean(record.verified)
            out.writeUTF(record.id)
            out.writeUTF(record.journalId)
            out.writeInt(record.earnChain)
            out.writeBoolean(record.earnRecoveryRequired)
            out.writeInt(record.credential.credentialId.size)
            out.write(record.credential.credentialId)
            out.write(record.credential.publicKeyX)
            out.write(record.credential.publicKeyY)
          }
        }
        .toByteArray()
    val footer =
      ByteArrayOutputStream()
        .apply {
          DataOutputStream(this).use { out ->
            out.writeUTF(record.roleRegistry)
            out.writeInt(record.earnCycleIndex)
            out.writeUTF(record.earnCycles)
          }
        }
        .toByteArray()
    val clear = header + record.entropy + footer
    try {
      file.write(CryptoEnvelope.encrypt(key ?: keys.existing() ?: keys.create(), clear, aad))
    } finally {
      clear.fill(0)
    }
  }
}
