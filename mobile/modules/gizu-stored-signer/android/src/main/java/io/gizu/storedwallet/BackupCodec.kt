package io.gizu.storedwallet

import java.util.Base64
import java.util.UUID
import javax.crypto.spec.SecretKeySpec
import org.json.JSONObject

internal object BackupCodec {
  private fun enc(bytes: ByteArray) = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  private fun dec(value: String) = Base64.getUrlDecoder().decode(value)

  private fun header(bytes: ByteArray): JSONObject {
    require(bytes.size in 1..65536)
    val h = JSONObject(String(bytes, Charsets.UTF_8))
    require(h.getString("format") == "gizu-stored-wallet" && h.get("version") == 1)
    require(
      h.getString("rpId") == "gizu.io" && h.getString("derivationVersion") == "gizu-stored-evm-v1"
    )
    UUID.fromString(h.getString("walletId"))
    return h
  }

  private fun aad(h: JSONObject): ByteArray =
    listOf(
        "gizu-stored-wallet",
        "1",
        "gizu.io",
        "gizu-stored-evm-v1",
        h.getString("walletId"),
        h.getString("credentialId"),
        h.getString("x"),
        h.getString("y"),
      )
      .joinToString(":")
      .toByteArray()

  fun credential(bytes: ByteArray): StoredPasskey {
    val h = header(bytes)
    return StoredPasskey(
        dec(h.getString("credentialId")),
        dec(h.getString("x")),
        dec(h.getString("y")),
      )
      .also {
        require(
          it.credentialId.size in 1..1024 && it.publicKeyX.size == 32 && it.publicKeyY.size == 32
        )
      }
  }

  fun encrypt(record: WalletRecord, prf: ByteArray): ByteArray {
    require(prf.size == 32)
    val h =
      JSONObject()
        .put("format", "gizu-stored-wallet")
        .put("version", 1)
        .put("rpId", "gizu.io")
        .put("derivationVersion", "gizu-stored-evm-v1")
        .put("walletId", record.id)
        .put("credentialId", enc(record.credential.credentialId))
        .put("x", enc(record.credential.publicKeyX))
        .put("y", enc(record.credential.publicKeyY))
    return h.put(
        "envelope",
        enc(CryptoEnvelope.encrypt(SecretKeySpec(prf, "AES"), record.entropy, aad(h))),
      )
      .toString()
      .toByteArray()
  }

  fun decrypt(bytes: ByteArray, prf: ByteArray): WalletRecord {
    require(prf.size == 32)
    val h = header(bytes)
    val credential = credential(bytes)
    val entropy =
      CryptoEnvelope.decrypt(SecretKeySpec(prf, "AES"), dec(h.getString("envelope")), aad(h))
    try {
      return WalletRecord(h.getString("walletId"), credential, entropy)
    } catch (e: Exception) {
      entropy.fill(0)
      throw e
    }
  }
}
