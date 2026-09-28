package io.gizu.storedwallet

import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

object CryptoEnvelope {
  private val magic = byteArrayOf(0x47, 0x53, 0x57, 0x31) // GSW1
  private const val nonceSize = 12

  fun encrypt(key: SecretKey, plaintext: ByteArray, aad: ByteArray): ByteArray {
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key)
    val nonce = cipher.iv
    require(nonce.size == nonceSize)
    cipher.updateAAD(aad)
    return magic + nonce + cipher.doFinal(plaintext)
  }

  fun decrypt(key: SecretKey, envelope: ByteArray, aad: ByteArray): ByteArray {
    require(envelope.size >= magic.size + nonceSize + 16)
    require(envelope.copyOfRange(0, magic.size).contentEquals(magic))
    val nonce = envelope.copyOfRange(magic.size, magic.size + nonceSize)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, nonce))
    cipher.updateAAD(aad)
    return cipher.doFinal(envelope, magic.size + nonceSize, envelope.size - magic.size - nonceSize)
  }
}
