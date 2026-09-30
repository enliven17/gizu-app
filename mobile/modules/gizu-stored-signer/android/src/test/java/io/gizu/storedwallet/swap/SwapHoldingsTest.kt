package io.gizu.storedwallet.swap

import java.math.BigInteger
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SwapHoldingsTest {
  private val token = "0x" + "ab".repeat(20)

  @Test
  fun balancesMatchResponseIdsRatherThanProviderOrder() {
    assertEquals(
      listOf("0x5", "0xa"),
      SwapHoldings.results("""[{"id":1,"result":"0xa"},{"id":0,"result":"0x5"}]""", 2),
    )
  }

  @Test
  fun missingDuplicateAndFailedBalancesNeverBecomeZero() {
    for (body in
      listOf(
        "[]",
        """[{"id":0,"result":"0x0"},{"id":0,"result":"0x0"}]""",
        """[{"id":0,"error":{}}]""",
      )) {
      assertThrows(Exception::class.java) { SwapHoldings.results(body, 2) }
    }
    assertThrows(Exception::class.java) { SwapHoldings.quantity("0x") }
    assertEquals(BigInteger("18446744073709551616"), SwapHoldings.quantity("0x10000000000000000"))
  }

  @Test
  fun sellSelectionRequiresTrackedTokenAndAllocatedRecipientBatch() {
    assertEquals(token to listOf(6, 7, 8), SwapHoldings.selection("$token:6", 12, listOf(token)))
    for (index in listOf(-1, 0, 1, 2, 4, 12, Int.MAX_VALUE)) {
      assertThrows(Exception::class.java) {
        SwapHoldings.selection("$token:$index", 12, listOf(token))
      }
    }
    assertThrows(Exception::class.java) { SwapHoldings.selection("$token:3", 12, emptyList()) }
  }

  @Test
  fun subsequentCancellationDoesNotEraseCompletedPurchaseHistory() {
    val history = JSONObject()
    SwapPortfolioStore.archive(
      history,
      JSONObject().put("operationId", "buy").put("phase", "COMPLETE"),
    )
    SwapPortfolioStore.archive(
      history,
      JSONObject().put("operationId", "next").put("phase", "CANCELLED"),
    )
    SwapPortfolioStore.archive(
      history,
      JSONObject().put("operationId", "buy").put("phase", "CANCELLED"),
    )
    assertEquals("COMPLETE", history.getJSONObject("buy").getString("phase"))
    assertEquals("CANCELLED", history.getJSONObject("next").getString("phase"))
  }
}
