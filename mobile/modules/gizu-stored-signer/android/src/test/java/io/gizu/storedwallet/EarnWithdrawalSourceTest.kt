package io.gizu.storedwallet

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun withdrawalReturn(): JSONObject {
  val f = EarnPayoutFixtures
  val op = f.source()
  val p = op.getJSONObject("proposal")
  p.put("kind", "returnUsdc").put("chainId", 1).put("cycleIndex", 2).remove("profileChainId")
  op.remove("signedUserOperation")
  op.put("raw", "private signed return transaction")
  op
    .getJSONObject("stateBinding")
    .getJSONObject("routeProof")
    .put("originAsset", ETH_USDC_ORIGIN_ASSET)
  return op
}

class EarnWithdrawalSourceTest {
  @Test
  fun legacyEthereumReturnUsesExactNativeReceiptAndCreditTuple() {
    val f = EarnPayoutFixtures
    val result = nativeWithdrawalSource(withdrawalReturn(), 11, f.owner, f.C, 1, 2)
    assertEquals(7, result.getInt("revision"))
    assertEquals("returnUsdc", result.getString("routeKind"))
    assertEquals(f.owner, result.getString("sourceOwner"))
    assertEquals(ETH_USDC_ORIGIN_ASSET, result.getString("originAsset"))
  }

  @Test
  fun publicFundingWrongCycleOwnerConfidentialOrUnauthenticatedCreditCannotWithdraw() {
    val f = EarnPayoutFixtures
    for (variant in 0..6) {
      val op = withdrawalReturn()
      val p = op.getJSONObject("proposal")
      when (variant) {
        0 -> p.put("kind", "sourceFunding")
        1 -> p.put("cycleIndex", 3)
        2 -> p.put("expectedFrom", f.recipient)
        3 -> p.put("confidentialAccount", f.recipient)
        4 -> op.getJSONObject("settlement").put("operationScoped", false)
        5 -> op.getJSONObject("settlement").put("creditedAtoms", "999999")
        6 -> op.remove("raw")
      }
      assertThrows(IllegalStateException::class.java) {
        nativeWithdrawalSource(op, 11, f.owner, f.C, 1, 2)
      }
    }
  }
}
