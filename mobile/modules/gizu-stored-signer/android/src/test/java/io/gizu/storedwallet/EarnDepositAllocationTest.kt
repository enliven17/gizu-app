package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class EarnDepositAllocationTest {
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private fun store() =
    WalletStore(
        DepositMemoryFile(),
        object : WalletKeys {
          override fun existing() = key

          override fun create() = key

          override fun reset() = key
        },
      )
      .also { s -> DepositFixtures.record().use { s.create(it) } }

  @Test
  fun allocationPersistsIdentityBeforeJourneyWriteAndReusesOnlyUnsignedDraft() {
    val store = store()
    val id = store.load().use { store.prepareEarnDepositCycle(it, 4663, null) }
    val pair =
      store.load().use { r ->
        assertEquals(1, r.earnCycleIndex)
        assertEquals(
          id,
          JSONArray(r.earnCycles)
            .objects()
            .single { it.getInt("cycleIndex") == 1 }
            .getString("depositJourneyId"),
        )
        cycleAddresses(r)
      }
    // Simulate death before the journal's initial atomic write.
    assertEquals(id, store.load().use { store.prepareEarnDepositCycle(it, 4663, null) })
    val j = testDepositJournal()
    val row = store.load().use { j.loadOrCreate(it, 4663, id) }
    assertEquals(id, row.getString("journeyId"))
    assertEquals(pair, store.load().use { cycleAddresses(it) })
    assertEquals(id, store.load().use { store.prepareEarnDepositCycle(it, 4663, id) })
    store.load().use { store.completeEarnDepositCycle(it, id) }
    val next = store.load().use { store.prepareEarnDepositCycle(it, 4663, null) }
    assertNotEquals(id, next)
    store.load().use {
      assertEquals(2, it.earnCycleIndex)
      assertNotEquals(pair, cycleAddresses(it))
    }
    try {
      store.load().use { store.prepareEarnDepositCycle(it, 4663, "unallocated") }
      fail("Invented allocation accepted")
    } catch (_: IllegalStateException) {}
  }
}
