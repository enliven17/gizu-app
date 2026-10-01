package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnVaultJournalTest {
  private val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val owner = "0x" + "1".repeat(40)
  private val hash = "0x" + "a".repeat(64)
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

  private fun journal(file: File, generation: String = wallet) =
    EarnVaultJournal(file, { key }, wallet, generation)

  private fun proposal(id: String = "deposit-1", kind: String = "vaultDeposit") =
    JSONObject()
      .put("operationId", id)
      .put("revision", 1)
      .put("kind", kind)
      .put("expectedFrom", owner)
      .put("amountAtoms", "1000000")

  private fun call() =
    JSONObject()
      .put("to", owner)
      .put("data", "0x095ea7b3")
      .put("nonce", "0")
      .put("valueWei", "0")
      .put("gasLimit", "65000")
      .put("maxFeePerGasWei", "10")
      .put("priorityFeePerGasWei", "1")

  private fun signed(j: EarnVaultJournal, id: String) {
    j.prepare(id, 1, JSONArray().put(call()), "0xreview", "full native review")
    j.persistSigned(id, 2, 0, "0x02abcdef", hash, owner, "0", "0xreview")
  }

  @Test
  fun encryptedRestartPublicAllowlistAndSharedDepositWithdrawalLock() {
    val file = File()
    val j = journal(file)
    j.create(proposal())
    signed(j, "deposit-1")
    assertFalse(String(file.bytes!!).contains("0x02abcdef"))
    val restored = journal(file)
    val op = restored.get("deposit-1")
    assertEquals("0x02abcdef", op.steps()[0].getString("raw"))
    assertEquals("unknown", op.steps()[0].getString("status"))
    assertTrue(restored.public(op)["blocked"] as Boolean)
    assertFalse(restored.public(op).toString().contains("0x02abcdef"))
    assertFalse(restored.public(op).toString().contains("data="))
    assertThrows(IllegalStateException::class.java) {
      restored.create(proposal("withdraw-2", "vaultRedeemAll"))
    }
    assertThrows(IllegalStateException::class.java) { restored.create(proposal()) }
  }

  @Test
  fun staleOwnerAndGenerationCannotWriteOrRecover() {
    val file = File()
    val j = journal(file)
    j.create(proposal())
    j.prepare("deposit-1", 1, JSONArray().put(call()), "0xreview", "review")
    assertThrows(IllegalStateException::class.java) {
      j.persistSigned("deposit-1", 1, 0, "0x02abcdef", hash, owner, "0", "0xreview")
    }
    assertThrows(IllegalStateException::class.java) {
      j.persistSigned("deposit-1", 2, 0, "0x02abcdef", hash, "0x" + "2".repeat(40), "0", "0xreview")
    }
    assertThrows(Exception::class.java) { journal(file, "restored-generation").all() }
  }

  @Test
  fun failedStorageDoesNotMakeSignedBytesAvailable() {
    val file = File()
    val j = journal(file)
    j.create(proposal())
    j.prepare("deposit-1", 1, JSONArray().put(call()), "0xreview", "review")
    file.fail = true
    assertThrows(IllegalStateException::class.java) {
      j.persistSigned("deposit-1", 2, 0, "0x02abcdef", hash, owner, "0", "0xreview")
    }
    assertFalse(j.get("deposit-1").steps()[0].has("raw"))
  }

  @Test
  fun finalDepositNeverCreatesWithdrawalAndReorgRelocks() {
    val j = journal(File())
    j.create(proposal())
    signed(j, "deposit-1")
    j.update("deposit-1", 3) { it.steps()[0].put("status", "finalized") }
    assertEquals("invested", j.public(j.get("deposit-1"))["status"])
    assertEquals(1, j.all().size)
    j.update("deposit-1", 4) { it.steps()[0].put("status", "pending") }
    assertTrue(j.public(j.get("deposit-1"))["blocked"] as Boolean)
  }
}
