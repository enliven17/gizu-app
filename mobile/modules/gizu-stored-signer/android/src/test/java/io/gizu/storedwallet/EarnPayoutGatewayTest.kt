package io.gizu.storedwallet

import org.junit.Assert.*
import org.junit.Test

class EarnPayoutGatewayTest {
  @Test
  fun entireNativeTlsBodyIsHashedAndServerHashClaimsCannotCreateProof() {
    val text = EarnPayoutFixtures.prepared().toString()
    val hashed = mutableListOf<String>()
    val gateway =
      NativePayoutGateway(
        bodyHash = {
          hashed.add(it)
          EarnPayoutFixtures.nativeHash
        },
        now = { EarnPayoutFixtures.now },
      )
    val q = gateway.decode(text)
    assertEquals(1, hashed.count { it == text })
    assertEquals(EarnPayoutFixtures.nativeHash, q.credit.authenticatedBodyHash)
    assertEquals(EarnPayoutFixtures.nativeHash, q.quote.authenticatedBodyHash)
    assertEquals(EarnPayoutFixtures.nativeHash, q.quote.sourceCreditBodyHash)
    assertEquals(EarnPayoutFixtures.nonce, q.nonce)
  }

  @Test
  fun staleCreditMalformedNonceAndChangedPayloadHashRejectBeforeNativeReview() {
    val f = EarnPayoutFixtures
    val gateway = NativePayoutGateway(bodyHash = { f.nativeHash }, now = { f.now })
    for (variant in 0..3) {
      val row = f.prepared()
      when (variant) {
        0 -> row.getJSONObject("sourceCredit").put("observedAtMs", f.now - 60001)
        1 -> row.getJSONObject("sourceCredit").put("expiresAtMs", f.now)
        2 -> row.getJSONObject("quote").put("payloadHash", f.hash)
        3 -> {
          val intent = row.getJSONObject("intent")
          val payload = org.json.JSONObject(intent.getString("payload"))
          payload.put("nonce", "A".repeat(42) + "B=")
          intent.put("payload", payload.toString())
        }
      }
      try {
        gateway.decode(row.toString())
        fail("Invalid native context $variant")
      } catch (_: IllegalStateException) {}
    }
  }
}
