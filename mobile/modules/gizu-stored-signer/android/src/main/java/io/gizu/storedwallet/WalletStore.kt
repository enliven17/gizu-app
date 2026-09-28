package io.gizu.storedwallet

import java.io.*
import java.util.UUID
import javax.crypto.SecretKey

/** Native-only model; deliberately not a data class (no secret-bearing toString/copy). */
internal class WalletRecord(
  val id: String,
  val credential: StoredPasskey,
  val entropy: ByteArray,
  val verified: Boolean = false,
  val journalId: String = id,
) : AutoCloseable {
  init {
    UUID.fromString(id)
    UUID.fromString(journalId)
    require(entropy.size == 32)
    require(credential.credentialId.size in 1..1024)
    require(credential.publicKeyX.size == 32 && credential.publicKeyY.size == 32)
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
        require(version in 1..3)
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
          require(input.available() == 0)
          return WalletRecord(id, credential, entropy, verified, journalId)
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
      WalletRecord(current.id, current.credential, current.entropy, true, current.journalId).use {
        save(it)
      }
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
      )
      .use { save(it, key) }
  }

  private fun save(record: WalletRecord, key: SecretKey? = null) {
    // Exact allocation avoids an extra unerasable ByteArrayOutputStream secret copy.
    val metadata =
      ByteArrayOutputStream()
        .apply {
          DataOutputStream(this).use { out ->
            out.writeInt(3)
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
    val clear = metadata + record.entropy
    val encrypted =
      try {
        CryptoEnvelope.encrypt(key ?: keys.existing() ?: keys.create(), clear, aad)
      } finally {
        clear.fill(0)
      }
    file.write(encrypted)
  }
}
