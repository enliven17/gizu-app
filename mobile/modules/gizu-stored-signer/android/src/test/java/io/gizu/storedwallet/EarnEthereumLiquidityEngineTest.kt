package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.*

class EarnEthereumLiquidityEngineTest {
  private val wallet = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val owner = "0x" + "1".repeat(40)
  private val confidential = "0x" + "2".repeat(40)
  private val recipient = "0x" + "3".repeat(40)
  private val hash = "0x" + "a".repeat(64)
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private class File : WalletFile {
    var bytes: ByteArray? = null
    var fail = false

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      check(!fail)
      this.bytes = bytes.copyOf()
    }
  }

  private fun store(recovery: Boolean = false): WalletStore {
    val store =
      WalletStore(
        File(),
        object : WalletKeys {
          override fun existing() = key

          override fun create() = key

          override fun reset() = key
        },
      )
    WalletRecord(
        wallet,
        StoredPasskey(byteArrayOf(1), ByteArray(32), ByteArray(32)),
        ByteArray(32),
        true,
        wallet,
        earnChain = 1,
        earnRecoveryRequired = recovery,
      )
      .use { store.create(it) }
    return store
  }

  private fun state() =
    NativeEthereumLiquidityState(
      1uL,
      owner,
      100uL,
      10uL,
      hash,
      "0x" + "b".repeat(64),
      4uL,
      "211000",
      "0",
      "0",
      "0",
      "0",
      "0",
      hash,
      "0",
      "0",
      "0x",
      "0x",
      "0",
      "1",
      hash,
      hash,
      hash,
      hash,
      hash,
      hash,
    )

  private fun setup(file: File = File(), kind: String = "returnEth"): EarnLiquidityJournal {
    val j = EarnLiquidityJournal(file, { key }, wallet, wallet)
    val p =
      JSONObject()
        .put("operationId", "liquidity-1")
        .put("revision", 7)
        .put("kind", kind)
        .put("chainId", 1)
        .put("expectedFrom", owner)
        .put("confidentialAccount", confidential)
        .put("quoteId", "preview")
        .put("amountAtoms", "1000")
        .put("nonce", 4)
        .put("deadline", System.currentTimeMillis() / 1000 + 300)
        .put("gasLimit", 21000)
        .put("maxFeePerGasWei", "10")
        .put("priorityFeePerGasWei", "0")
        .put("maximumGasCostWei", "210000")
        .put("withdrawalReserveWei", "0")
        .put("recipient", recipient)
    if (kind == "fusionEthOrder")
      p.put("fundingMode", "permit")
        .put("inputAtoms", "1000")
        .put("minimumEthWei", "10")
        .put("grossEthWei", "11")
        .put("maximumResolverOverheadWei", "5")
        .put("unsignedOrder", JSONObject().put("makerTraits", "0"))
        .put("extension", "0x")
    j.create(p)
    return j
  }

  private class Rpc : TransferRpc {
    var sends = 0
    val raws = mutableListOf<String>()

    override suspend fun call(method: String, params: JSONArray): Any {
      check(method == "eth_sendRawTransaction")
      sends++
      raws.add(params.getString(0))
      error("response lost")
    }
  }

  private var signatures = 0

  private inner class Signer(private val kind: String, private val changed: Boolean = false) :
    NativeLiquiditySigner {
    override fun prepare(
      revision: ULong,
      state: NativeEthereumLiquidityState,
      fusion: NativeFusionQuoteBinding?,
      returning: NativeEarnQuoteBinding?,
      permit: NativeSignedFusionPermit?,
    ) = if (changed) "changed review" else "exact review"

    override fun reviewHash() = if (changed) "0x" + "c".repeat(64) else hash

    override fun approve(revision: ULong, hash: String) {}

    override fun sign(revision: ULong, state: NativeEthereumLiquidityState): LiquiditySigned {
      signatures++
      return if (kind == "fusionUsdcPermit")
        LiquiditySigned.Permit(
          NativeSignedFusionPermit(
            owner,
            "1000",
            "0",
            (System.currentTimeMillis() / 1000 + 300).toULong(),
            "private-permit",
            hash,
            "private-permit-data",
          )
        )
      else
        LiquiditySigned.Transaction(
          NativeSignedEarnTransaction(
            "0xprivate-raw",
            hash,
            owner,
            4uL,
            "liquidity-1",
            revision,
            0u,
            hash,
          )
        )
    }

    override fun close() {}
  }

  private fun quote(p: JSONObject): NativeFusionQuote {
    val q =
      NativeFusionQuoteBinding(
        "liquidity-1",
        7uL,
        "preview",
        owner,
        confidential,
        "1000",
        "10",
        "11",
        p.getLong("deadline").toULong(),
        100uL,
        p.getLong("deadline").toULong(),
        hash,
        hash,
        hash,
        "1",
        "1",
        "1",
        "1",
        "13",
      )
    return NativeFusionQuote(
      q,
      p.getJSONObject("unsignedOrder"),
      "0x",
      false,
      JSONObject().put("requestedResolverGasPriceWei", "1"),
    )
  }

  @Test
  fun failedDurableCommitNeverBroadcastsRawTransaction() = runBlocking {
    val file = File()
    val j = setup(file)
    val rpc = Rpc()
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        signerFactory = { p, _ -> Signer(JSONObject(p).getString("kind")) },
        stateReader = { state() },
        returnReader = { null },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 1)
        file.fail = true
        try {
          engine.execute(review) {}
          fail("Commit must fail")
        } catch (_: IllegalStateException) {}
      }
    assertEquals(0, rpc.sends)
    assertFalse(j.get("liquidity-1").has("raw"))
  }

  @Test
  fun changedPostPasskeyReviewCannotSignOrSubmit() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    var made = 0
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        signerFactory = { p, _ -> Signer(JSONObject(p).getString("kind"), ++made >= 2) },
        stateReader = { state() },
        returnReader = { null },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 1)
        try {
          engine.execute(review) {}
          fail("Changed review must fail")
        } catch (_: IllegalStateException) {}
      }
    assertEquals(0, signatures)
    assertEquals(0, rpc.sends)
  }

  @Test
  fun permitStepOnlySavesAuthorityAndRequiresSeparateReviewForOrder() = runBlocking {
    val file = File()
    val j = setup(file, "fusionEthOrder")
    val rpc = Rpc()
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        signerFactory = { p, _ -> Signer(JSONObject(p).getString("kind")) },
        stateReader = { state() },
        fusionReader = { quote(it) },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 1)
        assertEquals("fusionUsdcPermit", review.kind)
        engine.execute(review) {}
      }
    assertTrue(j.get("liquidity-1").has("permit"))
    assertFalse(j.get("liquidity-1").has("signedOrder"))
    assertEquals(0, rpc.sends)
    assertEquals(1, signatures)
    assertFalse(String(file.bytes!!).contains("private-permit"))
    assertFalse(j.public(j.get("liquidity-1")).toString().contains("private-permit"))
  }

  @Test
  fun lostSubmissionRequiresFreshAuthorityAndRetriesOnlySavedBytes() = runBlocking {
    val file = File()
    val j = setup(file)
    val rpc = Rpc()
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        signerFactory = { p, _ -> Signer(JSONObject(p).getString("kind")) },
        stateReader = { state() },
        returnReader = { null },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 1)
        try {
          engine.execute(review) {}
          fail("Send lost")
        } catch (_: IllegalStateException) {}
      }
    assertTrue(j.get("liquidity-1").liquidityBlocked())
    assertEquals("unknown", j.get("liquidity-1").getString("status"))
    assertFalse(String(file.bytes!!).contains("private-raw"))
    j.update("liquidity-1", 2) { it.put("status", "signed") }
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        signerFactory = { _, _ -> error("Retry cannot sign") },
        stateReader = { state() },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 3)
        assertEquals("retry", review.kind)
        try {
          engine.execute(review) { error("Approval absent") }
          fail("No authority")
        } catch (_: IllegalStateException) {}
        assertEquals(1, rpc.sends)
        try {
          engine.execute(review) {}
          fail("Send lost again")
        } catch (_: IllegalStateException) {}
      }
    assertEquals(1, signatures)
    assertEquals(2, rpc.sends)
    assertEquals(rpc.raws[0], rpc.raws[1])
  }

  @Test
  fun restoreGateCannotReachLiquiditySigner() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    EarnLiquidityEngine(
        store(true),
        j,
        rpc,
        signerFactory = { _, _ -> error("No restored signer") },
        stateReader = { state() },
        reconcile = {},
      )
      .use { engine ->
        try {
          engine.prepare("liquidity-1", 1)
          fail("Restore gate")
        } catch (_: IllegalStateException) {}
      }
    assertEquals(0, signatures)
    assertEquals(0, rpc.sends)
  }

  @Test
  fun exactSignedOrderCarriesEncryptedRecoveryPrivatelyBeforeSubmission() = runBlocking {
    val file = File()
    val j = setup(file, "fusionEthOrder")
    val rpc = Rpc()
    val secret = "private-recovery-envelope"
    val p = j.get("liquidity-1").getJSONObject("proposal")
    j.update("liquidity-1", 1) {
      it
        .put("executableQuote", JSONObject().put("recoveryEnvelope", secret))
        .put(
          "permit",
          storedFusionPermit(
            NativeSignedFusionPermit(
              owner,
              "1000",
              "0",
              p.getLong("deadline").toULong(),
              "private-permit",
              hash,
              "private-permit-data",
            )
          ),
        )
    }
    var sent = false
    val gateway =
      NativeFusionGateway({ endpoint, body ->
        assertEquals("submit", endpoint)
        assertEquals(secret, JSONObject(body).getString("recoveryEnvelope"))
        val restored = EarnLiquidityJournal(file, { key }, wallet, wallet)
        assertEquals(
          secret,
          restored.get("liquidity-1").getJSONObject("signedOrder").getString("recoveryEnvelope"),
        )
        assertFalse(String(file.bytes!!).contains(secret))
        assertFalse(restored.public(restored.get("liquidity-1")).toString().contains(secret))
        sent = true
        error("lost response")
      })
    EarnLiquidityEngine(
        store(),
        j,
        rpc,
        gateway,
        signerFactory = { _, _ ->
          object : NativeLiquiditySigner {
            override fun prepare(
              revision: ULong,
              state: NativeEthereumLiquidityState,
              fusion: NativeFusionQuoteBinding?,
              returning: NativeEarnQuoteBinding?,
              permit: NativeSignedFusionPermit?,
            ) = "exact review"

            override fun reviewHash() = hash

            override fun approve(revision: ULong, hash: String) {}

            override fun sign(revision: ULong, state: NativeEthereumLiquidityState) =
              LiquiditySigned.Order(
                NativeSignedFusionOrder(
                  "liquidity-1",
                  revision,
                  "preview",
                  hash,
                  "private-signature",
                  p.getJSONObject("unsignedOrder").toString(),
                  "0x",
                  hash,
                )
              )

            override fun close() {}
          }
        },
        stateReader = { state() },
        fusionReader = { request ->
          assertEquals(secret, request.getString("recoveryEnvelope"))
          quote(p)
            .copy(executionAvailable = true, raw = JSONObject().put("recoveryEnvelope", secret))
        },
        reconcile = {},
      )
      .use { engine ->
        val review = engine.prepare("liquidity-1", 2)
        try {
          engine.execute(review) {}
          fail("Response lost")
        } catch (_: IllegalStateException) {}
      }
    assertTrue(sent)
  }
}
