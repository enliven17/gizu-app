package io.gizu.storedwallet

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BackupCodecTest {
  private fun record() =
    WalletRecord(
      "7aafcc2e-0891-4e31-a7d4-03780d7b4f12",
      StoredPasskey(byteArrayOf(1, 2, 3), ByteArray(32) { 3 }, ByteArray(32) { 4 }),
      ByteArray(32) { it.toByte() },
    )

  private val prf = ByteArray(32) { (it + 7).toByte() }

  @Test
  fun sharedIosFixtureUsesTheSameBackupEnvelope() {
    val bytes =
      checkNotNull(javaClass.getResourceAsStream("/android-compatible-backup.json")).use {
        it.readBytes()
      }
    BackupCodec.decrypt(bytes, ByteArray(32) { 7 }).use { record ->
      assertEquals("7aafcc2e-0891-4e31-a7d4-03780d7b4f12", record.id)
      assertArrayEquals(ByteArray(32), record.entropy)
      assertArrayEquals(byteArrayOf(1, 2, 3), record.credential.credentialId)
    }
  }

  @Test
  fun savedFileRoundTripPreservesWalletAndCredential() {
    record().use { original ->
      val file = BackupCodec.encrypt(original, prf)
      BackupCodec.decrypt(file, prf).use { restored ->
        assertEquals(original.id, restored.id)
        assertArrayEquals(original.entropy, restored.entropy)
        assertArrayEquals(original.credential.credentialId, restored.credential.credentialId)
        assertFalse(restored.verified)
      }
      assertFalse(file.contentEquals(BackupCodec.encrypt(original, prf)))
    }
  }

  @Test
  fun wrongPrfTamperedMetadataUnsupportedVersionAndTruncationFail() {
    val file = record().use { BackupCodec.encrypt(it, prf) }
    assertThrows(Exception::class.java) { BackupCodec.decrypt(file, ByteArray(32)) }
    for ((field, value) in
      listOf(
        "walletId" to "7aafcc2e-0891-4e31-a7d4-03780d7b4f13",
        "version" to 4,
        "rpId" to "other.io",
        "derivationVersion" to "other",
      )) {
      val changed = JSONObject(String(file)).put(field, value).toString().toByteArray()
      assertThrows(Exception::class.java) { BackupCodec.decrypt(changed, prf) }
    }
    assertThrows(Exception::class.java) { BackupCodec.decrypt(file.copyOf(file.size / 2), prf) }
    assertThrows(Exception::class.java) { BackupCodec.credential(ByteArray(65537)) }
  }
}
