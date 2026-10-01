package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnEthereumLiquidityJournalTest {
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

  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private fun p(id: String = "one") =
    JSONObject()
      .put("operationId", id)
      .put("kind", "fusionEthOrder")
      .put("quoteId", id)
      .put("expectedFrom", "0x" + "1".repeat(40))
      .put("inputAtoms", "1000")
      .put(
        "unsignedOrder",
        JSONObject().put("makerTraits", "1329227995784915872903807060280344576"),
      )

  @Test
  fun signedPermitIsEncryptedPrivateAndCannotBeCancelledToReleaseAuthority() {
    val file = File()
    val j = EarnLiquidityJournal(file, { key }, "wallet", "generation")
    j.create(p())
    j.update("one", 1) {
      it.put("permit", JSONObject().put("signature", "secret-permit")).put("status", "permitSaved")
    }
    j.cancel("one", 2)
    assertFalse(String(file.bytes!!).contains("secret-permit"))
    assertFalse(j.public(j.get("one")).toString().contains("secret-permit"))
    assertTrue(j.get("one").liquidityBlocked())
    assertThrows(IllegalStateException::class.java) { j.create(p("two")) }
  }

  @Test
  fun unknownOrderAndRawSubmissionKeepNonceLockedUntilFinalProof() {
    val file = File()
    val j = EarnLiquidityJournal(file, { key }, "wallet", "generation")
    j.create(p())
    j.update("one", 1) {
      it.put("signedOrder", JSONObject().put("signature", "secret-order")).put("status", "unknown")
    }
    assertTrue(j.get("one").liquidityBlocked())
    assertFalse(j.public(j.get("one")).toString().contains("secret-order"))
    j.update("one", 2) { it.put("status", "finalized") }
    assertFalse(j.get("one").liquidityBlocked())
    assertThrows(IllegalStateException::class.java) {
      j.create(p("two"))
    } // Protected order nonce cannot be reused even after completion.
  }

  @Test
  fun failedCommitAndWrongGenerationCannotExposeOrReplaceSavedPermit() {
    val file = File()
    val j = EarnLiquidityJournal(file, { key }, "wallet", "generation")
    j.create(p())
    file.fail = true
    assertThrows(IllegalStateException::class.java) {
      j.update("one", 1) { it.put("permit", "secret") }
    }
    assertFalse(j.get("one").has("permit"))
    assertThrows(Exception::class.java) {
      EarnLiquidityJournal(file, { key }, "wallet", "restored").all()
    }
  }
}
