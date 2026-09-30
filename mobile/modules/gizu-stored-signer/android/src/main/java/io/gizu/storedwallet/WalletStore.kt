package io.gizu.storedwallet

import java.io.*
import java.util.UUID
import javax.crypto.SecretKey
import org.json.JSONObject

internal const val INITIAL_ROLE_REGISTRY = """{"version":1,"nextRecipient":3}"""

internal fun requireRoleRegistry(value: String) {
  require(value.length in 1..1024)
  val parsed = JSONObject(value)
  require(
    parsed.length() == 2 && parsed.getInt("version") == 1 && parsed.getInt("nextRecipient") >= 3
  )
}

/** Native-only model; deliberately not a data class (no secret-bearing toString/copy). */
internal class WalletRecord(
  val id: String,
  val credential: StoredPasskey,
  val entropy: ByteArray,
  val verified: Boolean = false,
  val journalId: String = id,
  val roleRegistry: String = INITIAL_ROLE_REGISTRY,
) : AutoCloseable {
  init {
    UUID.fromString(id)
    UUID.fromString(journalId)
    require(entropy.size == 32)
    require(credential.credentialId.size in 1..1024)
    require(credential.publicKeyX.size == 32 && credential.publicKeyY.size == 32)
    requireRoleRegistry(roleRegistry)
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
    val key = keys.existing() ?: error("Missing storage key")
    val encrypted = file.read()
    require(encrypted.size in 1..8192)
    val clear = CryptoEnvelope.decrypt(key, encrypted, aad)
    try {
      DataInputStream(ByteArrayInputStream(clear)).use { input ->
        val version = input.readInt()
        require(version in 1..4)
        val verified = if (version >= 2) input.readBoolean() else false
        val id = input.readUTF()
        val journalId = if (version >= 3) input.readUTF() else id
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
          val registry = if (version >= 4) input.readUTF() else INITIAL_ROLE_REGISTRY
          require(input.available() == 0)
          return WalletRecord(id, credential, entropy, verified, journalId, registry)
        } catch (error: Exception) {
          entropy.fill(0)
          throw error
        }
      }
    } finally {
      clear.fill(0)
    }
  }

  fun create(record: WalletRecord) {
    check(!exists()) { "Existing wallet must not be overwritten" }
    save(record)
  }

  fun markVerified(expected: WalletRecord) {
    load().use { current ->
      check(
        current.id == expected.id &&
          java.security.MessageDigest.isEqual(current.entropy, expected.entropy)
      )
      check(current.credential.credentialId.contentEquals(expected.credential.credentialId))
      WalletRecord(
          current.id,
          current.credential,
          current.entropy,
          true,
          current.journalId,
          current.roleRegistry,
        )
        .use { save(it) }
    }
  }

  fun restore(record: WalletRecord) {
    check(state()["status"] in listOf("absent", "recoveryRequired"))
    val key = keys.reset()
    WalletRecord(
        record.id,
        record.credential,
        record.entropy.copyOf(),
        true,
        UUID.randomUUID().toString(),
        record.roleRegistry,
      )
      .use { save(it, key) }
  }

  fun persistRegistry(expectedId: String, registry: String) {
    requireRoleRegistry(registry)
    load().use { current ->
      check(current.id == expectedId)
      check(
        JSONObject(registry).getInt("nextRecipient") >=
          JSONObject(current.roleRegistry).getInt("nextRecipient")
      )
      WalletRecord(
          current.id,
          current.credential,
          current.entropy,
          current.verified,
          current.journalId,
          registry,
        )
        .use { save(it) }
    }
  }

  private fun save(record: WalletRecord, key: SecretKey? = null) {
    // Exact allocation avoids an extra unerasable ByteArrayOutputStream secret copy.
    val metadata =
      ByteArrayOutputStream()
        .apply {
          DataOutputStream(this).use { out ->
            out.writeInt(4)
            out.writeBoolean(record.verified)
            out.writeUTF(record.id)
            out.writeUTF(record.journalId)
            out.writeInt(record.credential.credentialId.size)
            out.write(record.credential.credentialId)
            out.write(record.credential.publicKeyX)
            out.write(record.credential.publicKeyY)
          }
        }
        .toByteArray()
    val registryHeader =
      ByteArrayOutputStream()
        .apply { DataOutputStream(this).use { out -> out.writeUTF(record.roleRegistry) } }
        .toByteArray()
    val clear = metadata + record.entropy + registryHeader
    val encrypted =
      try {
        CryptoEnvelope.encrypt(key ?: keys.existing() ?: keys.create(), clear, aad)
      } finally {
        clear.fill(0)
        registryHeader.fill(0)
      }
    file.write(encrypted)
  }
}
