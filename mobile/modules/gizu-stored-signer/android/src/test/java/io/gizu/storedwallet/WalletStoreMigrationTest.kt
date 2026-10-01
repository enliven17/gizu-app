package io.gizu.storedwallet

import java.io.ByteArrayOutputStream
import java.io.DataOutputStream
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WalletStoreMigrationTest {
  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private class Keys : WalletKeys {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    var creates = 0

    override fun existing() = key

    override fun create(): SecretKey {
      creates++
      return key
    }

    override fun reset() = key
  }

  private val id = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val journal = "7aafcc2e-0891-4e31-a7d4-03780d7b4f13"
  private val registry = """{"version":1,"nextRecipient":12}"""
  private val aad = "io.gizu.storedwallet.v1:wallet:gizu.io:gizu-stored-evm-v1".toByteArray()

  private fun historical(version: Int, earnLayout: Boolean = false) =
    ByteArrayOutputStream()
      .apply {
        DataOutputStream(this).use { out ->
          out.writeInt(version)
          if (version >= 2) out.writeBoolean(true)
          out.writeUTF(id)
          if (version >= 3) out.writeUTF(journal)
          if (earnLayout) {
            out.writeInt(4663)
            out.writeBoolean(true)
          }
          out.writeInt(3)
          out.write(byteArrayOf(1, 2, 3))
          out.write(ByteArray(32) { 3 })
          out.write(ByteArray(32) { 4 })
          out.write(ByteArray(32) { it.toByte() })
          if (version == 4 && !earnLayout) out.writeUTF(registry)
        }
      }
      .toByteArray()

  @Test
  fun everyHistoricalLayoutPreservesEntropyAndRolesAcrossVersionFiveRewrite() {
    for ((version, earn) in listOf(1 to false, 2 to false, 3 to false, 4 to false, 4 to true)) {
      val file = File()
      val keys = Keys()
      file.write(CryptoEnvelope.encrypt(keys.key, historical(version, earn), aad))
      val store = WalletStore(file, keys)
      store.load().use { record ->
        assertArrayEquals(ByteArray(32) { it.toByte() }, record.entropy)
        assertEquals(if (version >= 3) journal else id, record.journalId)
        assertEquals(version >= 2, record.verified)
        assertEquals(
          if (version == 4 && !earn) registry else INITIAL_ROLE_REGISTRY,
          record.roleRegistry,
        )
        assertEquals(if (earn) 4663 else 0, record.earnChain)
        assertEquals(earn, record.earnRecoveryRequired)
        assertEquals(0, record.earnCycleIndex)
        if (earn) {
          val row = JSONArray(record.earnCycles).getJSONObject(0)
          assertEquals(0, row.getInt("cycleIndex"))
          assertEquals("earn-v1:$id:robinhood-usdg", row.getString("intentId"))
        } else assertEquals("[]", record.earnCycles)
        store.markVerified(record)
      }
      val clear = CryptoEnvelope.decrypt(keys.key, file.read(), aad)
      try {
        assertEquals(5, java.io.DataInputStream(clear.inputStream()).readInt())
      } finally {
        clear.fill(0)
      }
      store.load().use { record ->
        assertArrayEquals(ByteArray(32) { it.toByte() }, record.entropy)
        assertEquals(earn, record.earnRecoveryRequired)
        assertEquals(if (earn) 4663 else 0, record.earnChain)
      }
      assertEquals(0, keys.creates)
    }
  }

  @Test
  fun ambiguousVersionFourMustConsumeEntireLayoutAndCorruptionNeverRewritesIt() {
    for (earn in listOf(false, true)) {
      val file = File()
      val keys = Keys()
      file.write(CryptoEnvelope.encrypt(keys.key, historical(4, earn) + byteArrayOf(0), aad))
      val original = file.read()
      val store = WalletStore(file, keys)
      assertEquals("recoveryRequired", store.state()["status"])
      assertThrows(Exception::class.java) { store.load() }
      assertArrayEquals(original, file.read())
      assertEquals(0, keys.creates)
    }
  }
}
