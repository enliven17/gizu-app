package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class FundingReservationsTest {
  private class File : WalletFile {
    var data: ByteArray? = null

    override fun exists() = data != null

    override fun read() = data!!.copyOf()

    override fun write(bytes: ByteArray) {
      data = bytes.copyOf()
    }
  }

  @Test
  fun operationIdentityCannotAliasAnotherFeatureOrRecoveredOwner() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    val b = "0x" + "2".repeat(40)
    fun leg(address: String, index: Int) =
      JSONObject()
        .put("address", address)
        .put("sourceIndex", index)
        .put("budgetAtoms", "1000000")
        .put("balanceAtoms", "3000000")
    ledger.reserveBatch("earn", "earn", 1, JSONArray().put(leg(a, 0)))
    ledger.reserveBatch("swap", "swap", 1, JSONArray().put(leg(b, 1)))
    ledger.bind("earn", a, "same", "1000000")
    ledger.bind("earn", a, "same", "1000000")
    assertThrows(IllegalStateException::class.java) { ledger.bind("swap", b, "same", "1000000") }
    assertThrows(IllegalStateException::class.java) {
      ledger.adoptSavedSource("same", b, 1, "1000000", 1, "swap")
    }
    ledger.markSigned("same")
    assertTrue(ledger.hasUnsettledSigned(a))
    assertFalse(ledger.hasUnsettledSigned(b))
  }

  @Test
  fun previouslyAliasedOperationCannotBypassAuthorityOrReleaseLocks() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    val b = "0x" + "2".repeat(40)
    fun leg(address: String, index: Int) =
      JSONObject()
        .put("address", address)
        .put("sourceIndex", index)
        .put("budgetAtoms", "1000000")
        .put("balanceAtoms", "3000000")
    ledger.reserveBatch("earn", "earn", 1, JSONArray().put(leg(a, 0)))
    ledger.bind("earn", a, "same", "1000000")
    ledger.reserveBatch("swap", "swap", 1, JSONArray().put(leg(b, 1)))
    ledger.bind("swap", b, "different", "1000000")
    val aad = "gizu-funding-reservations:v1:wallet:generation".toByteArray()
    val saved = JSONObject(String(CryptoEnvelope.decrypt(key, file.read(), aad), Charsets.UTF_8))
    saved
      .getJSONArray("batches")
      .getJSONObject(1)
      .getJSONArray("legs")
      .getJSONObject(0)
      .put("operationId", "same")
    file.write(CryptoEnvelope.encrypt(key, saved.toString().toByteArray(), aad))
    assertThrows(IllegalStateException::class.java) { ledger.assertActive("same") }
    assertThrows(IllegalStateException::class.java) { ledger.markSigned("same") }
    assertThrows(IllegalStateException::class.java) { ledger.complete("same") }
    assertThrows(IllegalStateException::class.java) {
      ledger.adoptSavedSource("same", a, 0, "1000000", 1)
    }
    assertEquals("1000000", ledger.reservedAtoms(a))
    assertEquals("1000000", ledger.reservedAtoms(b))
  }

  @Test
  fun swapAndEarnCannotReserveTheSameFundsAndSignedReservationSurvivesRestart() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    var now = 0L
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { now }
    val address = "0x" + "1".repeat(40)
    fun leg(budget: String) =
      JSONObject()
        .put("address", address)
        .put("sourceIndex", 0)
        .put("budgetAtoms", budget)
        .put("balanceAtoms", "7000000")
    ledger.reserveBatch("earn", "earn", 0, JSONArray().put(leg("5000000")))
    assertEquals("5000000", ledger.reservedAtoms(address))
    assertThrows(IllegalStateException::class.java) {
      ledger.reserveBatch("swap", "swap", 0, JSONArray().put(leg("3000000")))
    }
    ledger.bind("earn", address, "source_1", "5000000")
    ledger.markSigned("source_1")
    now = 300000
    assertEquals(
      "5000000",
      FundingReservations(file, { key }, "wallet", "generation") { now }.reservedAtoms(address),
    )
    assertThrows(IllegalStateException::class.java) { ledger.cancelUnsigned("source_1") }
    ledger.complete("source_1")
    assertEquals("0", ledger.reservedAtoms(address))
  }

  @Test
  fun unsignedReviewExpiryReleasesOnlyUnsignedReservations() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    var now = 0L
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { now }
    val address = "0x" + "2".repeat(40)
    ledger.reserveBatch(
      "review",
      "earn",
      0,
      JSONArray()
        .put(
          JSONObject()
            .put("address", address)
            .put("sourceIndex", 1)
            .put("budgetAtoms", "1000000")
            .put("balanceAtoms", "1000000")
        ),
    )
    now = 300000
    assertEquals("0", ledger.reservedAtoms(address))
  }

  @Test
  fun incompleteBatchCannotAuthorizeAndAnotherSignedNonceBlocksTheOwner() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    val b = "0x" + "2".repeat(40)
    fun leg(address: String) =
      JSONObject()
        .put("address", address)
        .put("sourceIndex", 0)
        .put("budgetAtoms", "1000000")
        .put("balanceAtoms", "3000000")
    ledger.reserveBatch("batch", "earn", 1, JSONArray().put(leg(a)).put(leg(b)))
    ledger.bind("batch", a, "one", "1000000")
    assertThrows(IllegalStateException::class.java) { ledger.assertActive("one") }
    assertThrows(IllegalStateException::class.java) { ledger.commitBatch("batch") }
    ledger.bind("batch", b, "two", "1000000")
    ledger.commitBatch("batch")
    ledger.assertActive("one")
    ledger.reserveBatch("swap", "swap", 1, JSONArray().put(leg(a)))
    ledger.bind("swap", a, "swap-one", "1000000")
    ledger.markSigned("one")
    assertThrows(IllegalStateException::class.java) { ledger.assertActive("swap-one") }
    ledger.complete("one")
    ledger.assertActive("swap-one")
  }

  @Test
  fun startedEarnBatchCannotDiscardUnsignedSiblingEvenAfterFirstCreditAndRestart() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    val b = "0x" + "2".repeat(40)
    fun leg(address: String, index: Int) =
      JSONObject()
        .put("address", address)
        .put("sourceIndex", index)
        .put("budgetAtoms", "1000000")
        .put("balanceAtoms", "3000000")
    ledger.reserveBatch("batch", "earn", 1, JSONArray().put(leg(a, 1)).put(leg(b, 3)))
    ledger.bind("batch", a, "one", "1000000")
    ledger.bind("batch", b, "two", "1000000")
    ledger.commitBatch("batch")
    ledger.assertCancellationAllowed("two")
    ledger.markSigned("one")
    ledger.complete("one")
    val recovered = FundingReservations(file, { key }, "wallet", "generation") { 300000L }
    assertThrows(IllegalStateException::class.java) { recovered.assertCancellationAllowed("two") }
    assertThrows(IllegalStateException::class.java) { recovered.cancelUnsigned("two") }
    recovered.assertActive("two")
    assertFalse(
      recovered.batch("batch").getJSONArray("legs").getJSONObject(1).optBoolean("cancelled")
    )
  }

  @Test
  fun importedSavedAuthorityAlsoBlocksAnAlreadyRegisteredOtherFeature() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    ledger.reserveBatch(
      "swap",
      "swap",
      0,
      JSONArray()
        .put(
          JSONObject()
            .put("address", a)
            .put("sourceIndex", 0)
            .put("budgetAtoms", "1000000")
            .put("balanceAtoms", "3000000")
        ),
    )
    ledger.bind("swap", a, "queued-swap", "1000000")
    ledger.adoptSavedSource("legacy-source", a, 0, "1000000", 0)
    assertThrows(IllegalStateException::class.java) { ledger.assertActive("queued-swap") }
    assertTrue(
      FundingReservations(file, { key }, "wallet", "generation") { 999999L }.hasUnsettledSigned(a)
    )
    ledger.complete("legacy-source")
    ledger.assertActive("queued-swap")
  }

  @Test
  fun swapRecoveryIsIndependentOfTheSelectedEarnCycleButEarnBindingIsImmutable() {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val ledger = FundingReservations(file, { key }, "wallet", "generation") { 0L }
    val a = "0x" + "1".repeat(40)
    fun leg() =
      JSONObject()
        .put("address", a)
        .put("sourceIndex", 1)
        .put("budgetAtoms", "1000000")
        .put("balanceAtoms", "3000000")
    ledger.reserveBatch("swap", "swap", 2, JSONArray().put(leg()))
    ledger.bind("swap", a, "swap-source", "1000000")
    ledger.adoptSavedSource("swap-source", a, 1, "1000000", 0, "swap")
    assertTrue(ledger.hasUnsettledSigned(a))
    ledger.reserveBatch("earn", "earn", 2, JSONArray().put(leg()))
    ledger.bind("earn", a, "earn-source", "1000000")
    assertThrows(IllegalStateException::class.java) {
      ledger.adoptSavedSource("earn-source", a, 1, "1000000", 3)
    }
  }
}
