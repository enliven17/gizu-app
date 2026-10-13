package io.gizu.storedwallet

import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnDepositRemainingTest {
  @Test
  fun aReferencedSourceCannotBeReconstructedFromAnUnsignedPreview() {
    DepositFixtures.record().use { r ->
      val original = DepositFixtures.funding(r)
      assertThrows(IllegalStateException::class.java) {
        depositRemainingSourceRecord(original, null, true)
      }
      assertEquals(
        original.toString(),
        depositRemainingSourceRecord(original, null, false).toString(),
      )
      val signed = JSONObject(original.toString()).put("signedUserOperation", "immutable")
      assertEquals(
        "immutable",
        depositRemainingSourceRecord(original, signed, true).getString("signedUserOperation"),
      )
    }
  }

  @Test
  fun freshReviewPreservesPaidChildrenAndShowsWorseUnsignedTerms() = runBlocking {
    for (investArrived in listOf(false, true)) DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val row = j.loadOrCreate(r, 4663, null)
      val id = row.getString("journeyId")
      val original = DepositFixtures.review(r).put("journeyId", id)
      j.saveReview(id, row.getInt("revision"), original)
      j.attachChild(id, j.get(id).getInt("revision"), "funding", "source0")
      j.attachChild(id, j.get(id).getInt("revision"), "hold", "paid_hold")
      j.pause(id, "termsChanged")
      val source =
        DepositFixtures.funding(r)
          .put("status", "finalized")
          .put("signedUserOperation", "immutable")
      val paid =
        DepositFixtures.payout(r)
          .put("operationId", "paid_hold")
          .put("status", "paid")
          .put("receivedAtoms", "99000")
          .put("signedData", "immutable")
      if (investArrived) j.attachChild(id, j.get(id).getInt("revision"), "invest", "pending_invest")
      val pending =
        JSONObject(paid.toString())
          .put("operationId", "pending_invest")
          .put("status", "submissionUnknown")
          .put("receivedAtoms", "880000")
      pending.getJSONObject("proposal").put("leg", "invest").put("amountAtoms", "891000")
      var authenticatedReads = 0
      var previews = 0
      val gateway =
        EarnDepositGateway(
          { path, body ->
            val b = JSONObject(body)
            val out =
              JSONObject()
                .put("kind", "preview")
                .put("readOnly", true)
                .put("executionAvailable", false)
                .put("operationId", b.getString("operationId"))
                .put("revision", b.getInt("revision"))
                .put("quotedAtMs", 100000)
                .put("expiresAtMs", 145000)
            if (path == "/native/payout/preview") {
              previews++
              check(b.getString("leg") == "invest")
              out
                .put("assumption", "indicative-unfunded-confidential-route")
                .put("profileChainId", 4663)
                .put("leg", "invest")
                .put("recipient", b.getString("recipient"))
                .put("amountAtoms", b.getString("amountAtoms"))
                .put("minimumOutputAtoms", "880000")
                .put("estimatedOutputAtoms", "880000")
                .put("referenceHash", "0x" + "1".repeat(64))
                .put("feePolicy", JSONObject())
            } else {
              check(
                path == "/robinhood/deposit-preview" &&
                  b.getString("startingUsdgAtoms") == if (investArrived) "880000" else "0"
              )
              out
                .put("assumption", "hypothetical-USDG-funding-isolated-fork")
                .put("profileId", "robinhood-usdg")
                .put("chainId", 4663)
                .put("owner", b.getString("owner"))
                .put("token", HOOD_EARN_USDG)
                .put("vault", HOOD_EARN_VAULT)
                .put("expectedUsdgAtoms", b.getString("expectedUsdgAtoms"))
                .put("startingUsdgAtoms", if (investArrived) "880000" else "0")
                .put("policyVersion", "robinhood-v1")
                .put("depositAmount", "850000")
                .put("depositFeeBudget", "15000")
                .put("withdrawalReserve", "15000")
                .put("previewShares", "850000")
                .put("maxSharePrice", "1000000000000000000000000000")
                .put("shareDecimals", 18)
            }
            out.toString()
          },
          { 100000 },
          { 4 },
        )
      val refresh =
        EarnDepositRemaining(
          j,
          gateway,
          { DepositRemainingSource(source, "990000") },
          { childId ->
            if (childId == "paid_hold") paid
            else
              reconcileDepositPayoutBeforeReview(pending) {
                authenticatedReads++
                JSONObject(it.toString()).put("status", "paid")
              }
          },
          { it.getString("receivedAtoms") },
          { original.getJSONObject("reservation") },
          { error("No deposit reference") },
          { 100000 },
        )
      val next = refresh.refresh(r, id, j.get(id).getInt("revision"))
      assertEquals("paused", next.getString("phase"))
      assertEquals(if (investArrived) 0 else 1, previews)
      assertEquals(if (investArrived) 1 else 0, authenticatedReads)
      assertEquals("paid_hold", next.getJSONObject("children").getJSONArray("hold").getString(0))
      assertEquals(
        "immutable",
        next
          .getJSONObject("review")
          .getJSONArray("fundingRows")
          .getJSONObject(0)
          .getString("signedUserOperation"),
      )
      val d = next.getJSONObject("review").getJSONObject("deposit")
      assertEquals("18750", d.getString("maximumFeeAtoms")) // 25% gas headroom.
      assertEquals("842500", d.getString("minimumAssetsAtoms"))
      assertEquals(100000, next.getJSONObject("review").getInt("quotedAtMs"))
      EarnDepositApproval.fromRemainingReview(r, next.getJSONObject("review"), 100000)
        .approveAfterPasskey(100001)
    }
  }
}
