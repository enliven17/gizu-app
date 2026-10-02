package io.gizu.storedwallet.swap

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SwapFundingBatchTest {
  private fun child(index: Int) =
    JSONObject()
      .put("sourceIndex", index)
      .put("fundingAddress", "0x" + "$index".repeat(40))
      .put("operationId", "child$index")
      .put("budgetAtoms", if (index == 0) "7" else "3")
      .put("state", "initial$index")
      .put("status", JSONObject().put("phase", "PREPARING").toString())

  private fun batch() =
    SwapFundingBatch.create(
      JSONObject().put("fundingBatchId", "batch1").put("fundingBatchSize", 2),
      JSONArray().put(child(0)).put(child(1)),
    )

  @Test
  fun onlyCanonicalCompletionAdvancesAndResumePreservesAllChildren() {
    val batch = batch()
    batch.record("signed-child0", JSONObject().put("phase", "FUNDING").toString())
    assertFalse(batch.advanceIfComplete())
    assertEquals(0, batch.currentIndex)
    batch.record("settled-child0", JSONObject().put("phase", "COMPLETE").toString())
    assertNotEquals(
      "COMPLETE",
      batch.publicStatus(JSONObject().put("phase", "COMPLETE")).getString("phase"),
    )
    assertTrue(batch.advanceIfComplete())
    assertEquals(1, batch.currentIndex)
    val restored = SwapFundingBatch.restore(JSONObject(batch.json.toString()))
    assertEquals(1, restored.currentIndex)
    assertEquals("initial1", restored.current.getString("state"))
    assertEquals(
      "settled-child0",
      restored.json.getJSONArray("children").getJSONObject(0).getString("state"),
    )
    assertFalse(restored.advanceIfComplete())
  }

  @Test
  fun cancellationNeverErasesSignedEarlierChildrenOrAdvancesUnsignedChildren() {
    val batch = batch()
    batch.record("signed-first", JSONObject().put("phase", "CANCELLED").toString())
    batch.cancel()
    val restored = SwapFundingBatch.restore(JSONObject(batch.json.toString()))
    assertTrue(restored.cancelled)
    assertFalse(restored.advanceIfComplete())
    assertEquals(0, restored.currentIndex)
    assertEquals("signed-first", restored.current.getString("state"))
    assertEquals(2, restored.size)
  }

  @Test
  fun restoredBatchRejectsSkippingAnIncompleteChild() {
    val batch = batch()
    batch.json.put("currentIndex", 1)
    assertThrows(Exception::class.java) { SwapFundingBatch.restore(batch.json) }
  }

  @Test
  fun startingAnotherInvestmentRetainsEncryptedSignedBatchHistory() {
    val previous =
      JSONObject()
        .put("operationId", "batch1")
        .put("state", "signed-private-state")
        .put("fundingBatch", batch().json)
    val history = SwapFundingBatch.archive(previous, "batch2")
    assertEquals(1, history.length())
    assertEquals("signed-private-state", history.getJSONObject(0).getString("state"))
    val current =
      JSONObject()
        .put("operationId", "batch2")
        .put("state", "new-child-state")
        .put("history", history)
    assertEquals(1, SwapFundingBatch.archive(current, "batch2").length())
    assertEquals(2, SwapFundingBatch.archive(current, "batch3").length())
    assertFalse(SwapFundingBatch.archive(current, "batch3").getJSONObject(1).has("history"))
  }
}
