package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal class DepositMemoryFile : WalletFile {
  var bytes: ByteArray? = null
  var fail = false

  override fun exists() = bytes != null

  override fun read() = bytes!!.copyOf()

  override fun write(bytes: ByteArray) {
    check(!fail)
    this.bytes = bytes.copyOf()
  }
}

internal fun testDepositJournal(file: WalletFile = DepositMemoryFile()): EarnDepositJournal {
  val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
  return EarnDepositJournal(file, { key }, DepositFixtures.wallet, DepositFixtures.wallet)
}

class EarnDepositPreparerTest {
  @Test
  fun reviewOnlyUsesIndividualPreviewReadsAndKeepsTheSameDraftPair() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      var selections = 0
      var releases = 0
      val requests = mutableListOf<JSONObject>()
      val gateway =
        EarnDepositGateway(
          { path, body ->
            val b = JSONObject(body)
            requests.add(b)
            when (path) {
              "/native/payout/preview" ->
                JSONObject()
                  .put("kind", "preview")
                  .put("readOnly", true)
                  .put("executionAvailable", false)
                  .put("assumption", "indicative-unfunded-confidential-route")
                  .put("operationId", b.getString("operationId"))
                  .put("revision", b.getInt("revision"))
                  .put("profileChainId", 4663)
                  .put("leg", b.getString("leg"))
                  .put("recipient", b.getString("recipient"))
                  .put("amountAtoms", b.getString("amountAtoms"))
                  .put("estimatedOutputAtoms", b.getString("amountAtoms"))
                  .put("minimumOutputAtoms", b.getString("amountAtoms"))
                  .put("feePolicy", JSONObject().put("totalFeeBps", 0))
                  .put("quotedAtMs", 1000)
                  .put("expiresAtMs", 46000)
                  .put("referenceHash", "0x" + "1".repeat(64))
                  .toString()
              "/robinhood/deposit-preview" ->
                JSONObject()
                  .put("kind", "preview")
                  .put("readOnly", true)
                  .put("executionAvailable", false)
                  .put("assumption", "hypothetical-USDG-funding-isolated-fork")
                  .put("operationId", b.getString("operationId"))
                  .put("revision", b.getInt("revision"))
                  .put("profileId", "robinhood-usdg")
                  .put("chainId", 4663)
                  .put("owner", b.getString("owner"))
                  .put("token", HOOD_EARN_USDG)
                  .put("vault", HOOD_EARN_VAULT)
                  .put("expectedUsdgAtoms", b.getString("expectedUsdgAtoms"))
                  .put("quotedAtMs", 1000)
                  .put("expiresAtMs", 45000)
                  .put("policyVersion", "robinhood-v1")
                  .put("depositAmount", "870000")
                  .put("depositFeeBudget", "10000")
                  .put("withdrawalReserve", "11000")
                  .put("shareDecimals", 18)
                  .put("previewShares", "870000")
                  .put("maxSharePrice", "1000000000000000000000000000")
                  .toString()
              else -> error("Preparation attempted an execution/auth endpoint")
            }
          },
          { 1000 },
          feeValidator = { policy ->
            check(policy.getInt("totalFeeBps") == 0)
            0
          },
        )
      val preparer =
        EarnDepositPreparer(
          j,
          gateway,
          { record, budget ->
            selections++
            check(record.id == r.id && budget == "1010000")
            val review = DepositFixtures.review(r)
            DepositSourceDraft(
              review.getJSONArray("fundingRows").objects(),
              review.getJSONObject("reservation"),
              mapOf("source0" to "990000"),
            )
          },
          { releases++ },
          { 1000 },
        )
      val first = preparer.prepare(r, 4663, "1010000", null)
      val next = preparer.prepare(r, 4663, "1010000", first.getString("journeyId"))
      assertEquals(first.getString("journeyId"), next.getString("journeyId"))
      assertEquals(
        first.getJSONArray("destinations").toString(),
        next.getJSONArray("destinations").toString(),
      )
      assertEquals(2, selections)
      assertEquals(1, releases)
      assertEquals(6, requests.size)
      assertTrue(requests.all { !it.has("accounts") && !it.has("signedData") })
      assertEquals(45000, next.getJSONObject("review").getInt("expiresAtMs"))
      assertEquals(
        "870000",
        next.getJSONObject("review").getJSONObject("deposit").getString("minimumSharesAtoms"),
      )
      assertEquals(0, next.getJSONObject("children").length())
    }
  }

  @Test
  fun missingDeploymentOrUnqualifiedPreviewBlocksBeforeChildCreation() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val preparer =
        EarnDepositPreparer(
          j,
          EarnDepositGateway({ _, _ -> error("HTTP 404") }, { 1000 }),
          { _, _ ->
            val review = DepositFixtures.review(r)
            DepositSourceDraft(
              review.getJSONArray("fundingRows").objects(),
              review.getJSONObject("reservation"),
              mapOf("source0" to "990000"),
            )
          },
          {},
          { 1000 },
        )
      val result = preparer.prepare(r, 4663, "1010000", null)
      assertEquals("paused", result.getString("phase"))
      assertEquals("previewUnavailable", result.getString("pauseReason"))
      assertFalse(result.has("review"))
      assertEquals(0, result.getJSONObject("children").length())
    }
  }

  @Test
  fun sourceFailureDiagnosticsExcludePrivateExceptionDetailsAndKeepSpendingBlocked() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val diagnostics = mutableListOf<List<String>>()
      val preparer =
        EarnDepositPreparer(
          j,
          EarnDepositGateway({ _, _ -> error("Should not request downstream previews") }),
          { _, _ ->
            throw EarnGatewayFailure("EARN_AURORA_FEE_UNQUALIFIED", "private-owner-and-secret")
          },
          {},
          { 1000 },
          reportFailure = { stage, code, location ->
            diagnostics.add(listOf(stage, code, location))
          },
        )
      val result = preparer.prepare(r, 4663, "1010000", null)
      assertEquals("previewUnavailable", result.getString("pauseReason"))
      assertEquals(0, result.getJSONObject("children").length())
      assertEquals(1, diagnostics.size)
      assertEquals("sources", diagnostics.single()[0])
      assertEquals("EARN_AURORA_FEE_UNQUALIFIED", diagnostics.single()[1])
      assertTrue(diagnostics.single()[2].startsWith("EarnDepositPreparerTest.kt:"))
      assertFalse(diagnostics.toString().contains("private-owner-and-secret"))
      assertFalse(diagnostics.toString().contains(r.id))
    }
  }

  @Test
  fun payoutFailureDiagnosticsIdentifyTheLegWithoutLoggingRequestData() = runBlocking {
    DepositFixtures.record().use { r ->
      val j = testDepositJournal()
      val diagnostics = mutableListOf<List<String>>()
      val preparer =
        EarnDepositPreparer(
          j,
          EarnDepositGateway({ _, _ -> throw RpcFailure(RpcFailureCode.HTTP) }, { 1000 }),
          { _, _ ->
            val review = DepositFixtures.review(r)
            DepositSourceDraft(
              review.getJSONArray("fundingRows").objects(),
              review.getJSONObject("reservation"),
              mapOf("source0" to "990000"),
            )
          },
          {},
          { 1000 },
          reportFailure = { stage, code, location ->
            diagnostics.add(listOf(stage, code, location))
          },
        )
      val result = preparer.prepare(r, 4663, "1010000", null)
      assertEquals("previewUnavailable", result.getString("pauseReason"))
      assertFalse(result.has("review"))
      assertEquals("hold-preview", diagnostics.single()[0])
      assertEquals("HTTP", diagnostics.single()[1])
      assertFalse(diagnostics.toString().contains("990000"))
      assertFalse(diagnostics.toString().contains(cycleConfidential(r)))
    }
  }
}
