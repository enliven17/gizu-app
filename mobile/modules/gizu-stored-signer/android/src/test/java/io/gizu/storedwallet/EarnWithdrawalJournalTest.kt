package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnWithdrawalJournalTest {
  private val hash = "0x" + "a".repeat(64)
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private fun proposal(id: String = "withdraw1", returned: String = "return1", tx: String = hash) =
    JSONObject()
      .put("kind", "confidentialWithdrawal")
      .put("operationId", id)
      .put("revision", 1)
      .put("profileChainId", 1)
      .put("cycleIndex", 2)
      .put("recipientIndex", 4)
      .put("returnOperationId", returned)
      .put("returnTransactionHash", tx)
      .put("returnQuoteId", hash)
      .put("returnHistoryId", hash)
      .put("expectedSigner", "0x" + "1".repeat(40))
      .put("expectedRecipient", "0x" + "2".repeat(40))
      .put("creditedAtoms", "999")
      .put("amountAtoms", "999")
      .put("minimumDestinationAtoms", "1")
      .put("deadlineMs", 2000000)

  private fun journal(f: File) = EarnWithdrawalJournal(f, { key }, "wallet", "generation")

  @Test
  fun signedChildIsEncryptedAndRetryOnlyAcrossRestart() {
    val f = File()
    val j = journal(f)
    val op = j.create(proposal(), "private body", "nonce1", hash, hash, "source")
    val id = op.getString("operationId")
    j.saveSigned(id, "withdrawal", 1, "private signature", "review", hash)
    assertFalse(String(f.bytes!!).contains("private signature"))
    val saved = journal(f).get(id)
    assertEquals("private signature", saved.getString("signedData"))
    assertFalse(j.public(saved).toString().contains("private"))
    assertEquals("return1", j.public(saved)["returnOperationId"])
    assertEquals(143L, j.public(saved)["chainId"])
    assertThrows(IllegalStateException::class.java) { j.cancelUnsigned(id, 2) }
  }

  @Test
  fun returnAliasesAndSeenNoncesCannotCreateAnotherPayout() {
    val j = journal(File())
    j.create(proposal(), "body", "nonce1", hash, hash)
    assertThrows(IllegalStateException::class.java) {
      j.create(proposal("withdraw2", "alias"), "body", "nonce2", hash, hash)
    }
    assertThrows(IllegalStateException::class.java) {
      j.create(
        proposal("withdraw2", "return2", "0x" + "b".repeat(64)),
        "body",
        "nonce1",
        hash,
        hash,
      )
    }
    j.create(proposal("withdraw2", "return2", "0x" + "b".repeat(64)), "body", "nonce2", hash, hash)
    assertEquals(2, j.all().size)
  }

  @Test
  fun refreshCannotChangeCycleReturnRecipientOrCredit() {
    val j = journal(File())
    val p = proposal()
    val id = j.create(p, "body", "nonce1", hash, hash, "source").getString("operationId")
    j.cancelUnsigned(id, 1)
    for ((field, value) in
      listOf(
        "cycleIndex" to 3,
        "recipientIndex" to 5,
        "returnOperationId" to "alias",
        "creditedAtoms" to "998",
        "expectedRecipient" to "other",
      )) {
      assertThrows(IllegalStateException::class.java) {
        j.refreshUnsigned(id, 2, JSONObject(p.toString()).put(field, value), "body", "nonce2", hash)
      }
    }
    val fresh = j.refreshUnsigned(id, 2, p, "fresh", "nonce2", hash)
    assertEquals(3, fresh.getInt("revision"))
    assertEquals(2, fresh.getJSONArray("nonceHistory").length())
    assertEquals("withdrawal", j.evidence(id, "withdrawal", 3, 100).leg)
  }

  @Test
  fun existingPrivatePayoutNonceCannotBeReusedForWithdrawal() {
    val f = File()
    var seen = false
    val j =
      EarnWithdrawalJournal(f, { key }, "wallet", "generation") { _, nonce ->
        seen && nonce == "nonce1"
      }
    seen = true
    assertThrows(IllegalStateException::class.java) {
      j.create(proposal(), "body", "nonce1", hash, hash)
    }
    seen = false
    val id = j.create(proposal(), "body", "nonce1", hash, hash).getString("operationId")
    seen = true
    assertThrows(IllegalStateException::class.java) { j.evidence(id, "withdrawal", 1, 100) }
  }
}
