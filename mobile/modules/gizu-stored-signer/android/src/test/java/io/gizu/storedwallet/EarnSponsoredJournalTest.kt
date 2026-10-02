package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnSponsoredJournalTest {
  private val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private class File : WalletFile {
    var bytes: ByteArray? = null
    var fail = false

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      check(!fail)
      this.bytes = bytes.copyOf()
    }
  }

  private fun proposal(id: String = "source-1") =
    JSONObject()
      .put("operationId", id)
      .put("revision", 7)
      .put("kind", "sourceFunding")
      .put("chainId", 143)
      .put("expectedFrom", "0x" + "1".repeat(40))
      .put("amountAtoms", "1000000")
      .put("nonce", "0x0")

  private fun journal(file: File, generation: String = wallet) =
    EarnSponsoredJournal(file, { key }, wallet, generation)

  @Test
  fun delegationAloneCanBeDiscardedWithoutRevokingOrReusingSavedAuthority() {
    val file = File()
    val j = journal(file)
    j.create(proposal().put("deadline", 1), JSONObject().put("sender", "owner"))
    j.saveAuthorization(
      "source-1",
      1,
      JSONObject().put("r", "private-r").put("s", "private-s").put("nonce", 4),
      "review",
      "hash",
    )
    assertFalse(String(file.bytes!!).contains("private-r"))
    val restarted = journal(file)
    val op = restarted.get("source-1")
    assertTrue(op.sponsoredBlocked())
    assertEquals("private-r", op.getJSONObject("authorization").getString("r"))
    assertFalse(restarted.public(op).toString().contains("private-r"))
    assertEquals(true, restarted.public(op)["canCancelPreparation"])
    assertTrue(
      (restarted.public(op)["preparationCancellationDisclosure"] as String).contains(
        "does not revoke"
      )
    )
    restarted.cancel("source-1", 2)
    val discarded = restarted.get("source-1")
    assertFalse(discarded.sponsoredBlocked())
    assertEquals("private-r", discarded.getJSONObject("authorization").getString("r"))
    assertEquals("cancelled", restarted.public(discarded)["status"])
    assertEquals(false, restarted.public(discarded)["canResume"])
    restarted.create(proposal("source-2"), JSONObject())
    assertThrows(IllegalStateException::class.java) {
      restarted.saveSigned("source-1", 3, "hash", "raw", "review", "hash", JSONObject())
    }
  }

  @Test
  fun userOperationPersistsBeforeAnySendAndStaleWritesFail() {
    val file = File()
    val j = journal(file)
    j.create(proposal(), JSONObject())
    j.saveSigned(
      "source-1",
      1,
      "0xhash",
      "{\"signature\":\"private-signature\"}",
      "review",
      "hash",
      JSONObject().put("nonce", "0x0"),
    )
    val op = journal(file).get("source-1")
    assertEquals("unknown", op.getString("status"))
    assertTrue(op.sponsoredBlocked())
    assertFalse(j.public(op).toString().contains("private-signature"))
    assertThrows(IllegalStateException::class.java) {
      j.saveSigned("source-1", 1, "new-hash", "new-payload", "review", "hash", JSONObject())
    }
    assertThrows(Exception::class.java) { journal(file, "restored-generation").all() }
  }

  @Test
  fun failedCommitKeepsUnsignedAndCannotReleaseAuthLock() {
    val file = File()
    val j = journal(file)
    j.create(proposal(), JSONObject())
    file.fail = true
    assertThrows(IllegalStateException::class.java) {
      j.saveSigned("source-1", 1, "hash", "payload", "review", "hash", JSONObject())
    }
    assertFalse(j.get("source-1").has("signedUserOperation"))
    file.fail = false
    j.cancel("source-1", 1)
    assertFalse(j.get("source-1").sponsoredBlocked())
    j.create(proposal("source-2"), JSONObject())
  }

  @Test
  fun noSignedSpendingAuthorityCanBeCancelledOrHiddenAsCancelled() {
    for (status in listOf("unknown", "signed", "pending", "finalized", "reverted")) {
      val j = journal(File())
      j.create(proposal(), JSONObject())
      j.saveSigned("source-1", 1, "hash", "private-raw", "review", "hash", JSONObject())
      j.update("source-1", 2) { it.put("status", status) }
      assertEquals(false, j.public(j.get("source-1"))["canCancelPreparation"])
      assertThrows(IllegalStateException::class.java) { j.cancel("source-1", 3) }
      if (status !in terminalSteps) {
        j.update("source-1", 3) {
          it.put("cancelled", true)
        } // Historical journal written by older native code.
        assertEquals(status, j.public(j.get("source-1"))["status"])
        assertTrue(j.get("source-1").sponsoredBlocked())
        assertThrows(IllegalStateException::class.java) {
          j.create(proposal("source-2"), JSONObject())
        }
      }
    }
  }

  @Test
  fun rawSpendAndPendingSigningCannotDiscardPreparation() {
    for (field in listOf("raw", "rawTransaction", "signingPending")) {
      val j = journal(File())
      j.create(proposal(), JSONObject())
      j.update("source-1", 1) {
        it.put(field, if (field == "signingPending") true else "private-raw")
      }
      assertEquals(false, j.public(j.get("source-1"))["canCancelPreparation"])
      assertThrows(IllegalStateException::class.java) { j.cancel("source-1", 2) }
    }
  }
}
