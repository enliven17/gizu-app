package io.gizu.storedwallet

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal fun withdrawalPrepared(): JSONObject {
  val f = EarnPayoutFixtures
  val root = f.prepared()
  val credit =
    root
      .getJSONObject("sourceCredit")
      .put("operationId", "withdraw1")
      .put("revision", 1)
      .put("sourceChainId", 1)
      .put("sourceToken", ETH_EARN_USDC)
      .put("sourceAssetId", ETH_USDC_ORIGIN_ASSET)
  val quote =
    root
      .getJSONObject("quote")
      .put("operationId", "withdraw1")
      .put("revision", 1)
      .put("leg", "withdrawal")
      .put("destinationChainId", 143)
      .put("destinationToken", MONAD_EARN_USDC)
      .put("sourceAssetId", ETH_USDC_ORIGIN_ASSET)
      .put("amountAtoms", "1000001")
  return root
    .put("sourceCredit", JSONObject().put("returnOperationId", "return1").put("credit", credit))
    .put("quote", JSONObject().put("destinationChainId", 143).put("quote", quote))
}

class EarnWithdrawalGatewayTest {
  @Test
  fun bothNestedProofsUseHashOfEntireOriginalTlsBody() {
    val f = EarnPayoutFixtures
    val text = withdrawalPrepared().toString()
    val hashed = mutableListOf<String>()
    val p =
      NativeWithdrawalGateway(
          bodyHash = {
            hashed.add(it)
            f.nativeHash
          },
          now = { f.now },
        )
        .decode(text)
    assertEquals(1, hashed.count { it == text })
    assertEquals("return1", p.credit.returnOperationId)
    assertEquals(f.nativeHash, p.credit.credit.authenticatedBodyHash)
    assertEquals(f.nativeHash, p.quote.quote.sourceCreditBodyHash)
    assertEquals(143uL, p.quote.destinationChainId)
  }

  @Test
  fun staleCreditWrongDestinationWrongLegAndPayloadTamperingReject() {
    val f = EarnPayoutFixtures
    val g = NativeWithdrawalGateway(bodyHash = { f.nativeHash }, now = { f.now })
    for (variant in 0..4) {
      val p = withdrawalPrepared()
      val q = p.getJSONObject("quote")
      when (variant) {
        0 ->
          p.getJSONObject("sourceCredit").getJSONObject("credit").put("observedAtMs", f.now - 60001)
        1 -> q.put("destinationChainId", 1)
        2 -> q.getJSONObject("quote").put("destinationToken", ETH_EARN_USDC)
        3 -> q.getJSONObject("quote").put("leg", "hold")
        4 -> q.getJSONObject("quote").put("payloadHash", f.hash)
      }
      assertThrows(IllegalStateException::class.java) { g.decode(p.toString()) }
    }
  }
}
