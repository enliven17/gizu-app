package io.gizu.storedwallet

import java.util.Base64
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.SecretKeySpec
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class BackupCodecV3Test {
  private val prf = ByteArray(32) { 7 }

  private fun fixture() =
    checkNotNull(javaClass.getResourceAsStream("/android-compatible-backup-v3.json")).use {
      it.readBytes()
    }

  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private class Keys : WalletKeys {
    var value: SecretKey? = null

    override fun existing() = value

    override fun create() =
      value ?: KeyGenerator.getInstance("AES").apply { init(256) }.generateKey().also { value = it }

    override fun reset(): SecretKey {
      value = null
      return create()
    }
  }

  @Test
  fun swiftFixtureRestoresEveryNativeCatalogueFieldWithoutPublishingThem() {
    BackupCodec.decrypt(fixture(), prf).use { record ->
      assertArrayEquals(ByteArray(32), record.entropy)
      assertEquals(7, JSONObject(record.roleRegistry).getInt("nextRecipient"))
      assertEquals(1, record.earnChain)
      assertFalse(record.earnRecoveryRequired)
      assertEquals(2, record.earnCycleIndex)
      val rows = JSONArray(record.earnCycles)
      assertEquals(2, rows.length())
      assertEquals(4663, rows.getJSONObject(0).getInt("chainId"))
      assertEquals(3, rows.getJSONObject(0).getInt("withdrawalIndex"))
      assertEquals(1, rows.getJSONObject(1).getInt("chainId"))
      assertEquals(6, rows.getJSONObject(1).getInt("withdrawalIndex"))
      val encoded = BackupCodec.encrypt(record, prf)
      val header = JSONObject(String(encoded))
      assertEquals(3, header.getInt("version"))
      for (field in
        listOf(
          "entropy",
          "roleRegistry",
          "earnChain",
          "earnRecoveryRequired",
          "earnCycleIndex",
          "earnCycles",
        )) assertFalse(header.has(field))
      assertFalse(String(encoded).contains("nextRecipient"))
      assertFalse(String(encoded).contains("withdrawalIndex"))
      BackupCodec.decrypt(encoded, prf).use { copy ->
        assertEquals(record.roleRegistry, copy.roleRegistry)
        assertEquals(record.earnCycles, copy.earnCycles)
        assertEquals(record.earnCycleIndex, copy.earnCycleIndex)
      }
      assertThrows(Exception::class.java) { BackupCodec.decrypt(encoded, ByteArray(32) { 8 }) }
    }
  }

  @Test
  fun restorePreservesCatalogueButRequiresReconciliationBeforeAnotherCycle() {
    val store = WalletStore(File(), Keys())
    BackupCodec.decrypt(fixture(), prf).use { record ->
      store.restore(record)
      store.load().use { restored ->
        assertEquals(record.roleRegistry, restored.roleRegistry)
        assertEquals(record.earnCycles, restored.earnCycles)
        assertEquals(record.earnCycleIndex, restored.earnCycleIndex)
        assertEquals(record.earnChain, restored.earnChain)
        assertTrue(restored.verified)
        assertTrue(restored.earnRecoveryRequired)
        assertNotEquals(record.journalId, restored.journalId)
        assertThrows(IllegalStateException::class.java) { store.allocateEarnCycle(restored, 1) }
        assertThrows(IllegalStateException::class.java) { store.reserveEarnWithdrawal(restored) }
        assertEquals(setOf("status", "walletId"), restored.publicState().keys)
      }
    }
  }

  @Test
  fun historicalV2RegistryRemainsAuthenticatedAndEarnMetadataDefaultsToLegacy() {
    val header =
      JSONObject(String(fixture()))
        .put("version", 2)
        .put("roleRegistry", """{"version":1,"nextRecipient":9}""")
    val fields =
      listOf(
        "gizu-stored-wallet",
        "2",
        "gizu.io",
        "gizu-stored-evm-v1",
        header.getString("walletId"),
        header.getString("credentialId"),
        header.getString("x"),
        header.getString("y"),
        header.getString("roleRegistry"),
      )
    header.put(
      "envelope",
      Base64.getUrlEncoder()
        .withoutPadding()
        .encodeToString(
          CryptoEnvelope.encrypt(
            SecretKeySpec(prf, "AES"),
            ByteArray(32),
            fields.joinToString(":").toByteArray(),
          )
        ),
    )
    BackupCodec.decrypt(header.toString().toByteArray(), prf).use { record ->
      assertEquals(9, JSONObject(record.roleRegistry).getInt("nextRecipient"))
      assertEquals(0, record.earnChain)
      assertEquals(0, record.earnCycleIndex)
      assertEquals("[]", record.earnCycles)
    }
    header.put("roleRegistry", """{"version":1,"nextRecipient":10}""")
    assertThrows(Exception::class.java) {
      BackupCodec.decrypt(header.toString().toByteArray(), prf)
    }
  }
}
