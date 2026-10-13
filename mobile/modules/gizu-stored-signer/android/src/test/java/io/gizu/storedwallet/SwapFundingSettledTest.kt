package io.gizu.storedwallet

import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SwapFundingSettledTest {
  private fun status(phase: String, step: String, paused: String? = null) =
    JSONObject().put("phase", phase).put("step", step).put("pausedCode", paused ?: JSONObject.NULL)

  @Test
  fun aRefundedOrCancelledSwapReleasesItsSourceOnceTheTransferIsKnown() {
    // The mainnet case: Aurora refunded the deposit, then the user cancelled the swap.
    assertTrue(swapFundingSettled(status("PAUSED", "credit", "FUNDING_REFUNDED")))
    assertTrue(swapFundingSettled(status("CANCELLED", "credit", "FUNDING_REFUNDED")))
    assertTrue(swapFundingSettled(status("PAUSED", "fundingReceipt", "FUNDING_REVERTED")))
    assertTrue(swapFundingSettled(status("PAYOUTS", "payoutStatus")))
    assertTrue(swapFundingSettled(status("COMPLETE", "done")))
  }

  @Test
  fun aTransferThatMayStillBePendingKeepsTheSourceLocked() {
    for (step in listOf("fundingSign", "fundingSubmit", "fundingReceipt", "sourceChain")) {
      assertFalse(step, swapFundingSettled(status("FUNDING", step)))
      assertFalse(step, swapFundingSettled(status("CANCELLED", step)))
      assertFalse(step, swapFundingSettled(status("PAUSED", step, "NETWORK_UNAVAILABLE")))
    }
  }
}
