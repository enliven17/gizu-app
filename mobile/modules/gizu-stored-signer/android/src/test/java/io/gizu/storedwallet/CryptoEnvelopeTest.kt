package io.gizu.storedwallet

import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Test

class CryptoEnvelopeTest {
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
  private val aad = "wallet-state-v1".toByteArray()

  @Test
  fun decryptsOnlyMatchingRecord() {
    val plaintext = "test-only-secret".toByteArray()
    val encrypted = CryptoEnvelope.encrypt(key, plaintext, aad)
    assertArrayEquals(plaintext, CryptoEnvelope.decrypt(key, encrypted, aad))
    assertThrows(AEADBadTagException::class.java) {
      CryptoEnvelope.decrypt(key, encrypted, "other-record".toByteArray())
    }
  }

  @Test
  fun usesFreshNonceEveryWrite() {
    val plaintext = "same-data".toByteArray()
    val first = CryptoEnvelope.encrypt(key, plaintext, aad)
    val second = CryptoEnvelope.encrypt(key, plaintext, aad)
    assertFalse(first.contentEquals(second))
  }
}
