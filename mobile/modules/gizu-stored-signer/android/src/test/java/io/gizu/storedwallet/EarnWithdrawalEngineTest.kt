package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.*

class EarnWithdrawalEngineTest {
  private val f = EarnPayoutFixtures
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

  private var signs = 0
  private val submissions = mutableListOf<String>()

  private fun store() =
    WalletStore(
        File(),
        object : WalletKeys {
          override fun existing() = key

          override fun create() = key

          override fun reset() = key
        },
      )
      .also { s ->
        WalletRecord(
            f.wallet,
            StoredPasskey(byteArrayOf(1), ByteArray(32), ByteArray(32)),
            ByteArray(32),
            true,
            f.wallet,
            "{\"version\":1,\"nextRecipient\":4}",
            1,
            false,
            2,
            "[{\"cycleIndex\":2,\"chainId\":1,\"withdrawalIndex\":3}]",
          )
          .use(s::create)
      }

  private fun proposal() =
    JSONObject()
      .put("kind", "confidentialWithdrawal")
      .put("operationId", "withdraw1")
      .put("revision", 1)
      .put("profileChainId", 1)
      .put("cycleIndex", 2)
      .put("recipientIndex", 3)
      .put("returnOperationId", "return1")
      .put("returnQuoteId", f.hash)
      .put("returnTransactionHash", f.hash)
      .put("returnHistoryId", f.hash)
      .put("expectedSigner", f.C)
      .put("expectedRecipient", f.recipient)
      .put("creditedAtoms", "1000001")
      .put("amountAtoms", "1000001")
      .put("quoteId", f.hash)
      .put("minimumDestinationAtoms", "1")
      .put("deadlineMs", f.now + 240000)

  private inner class Signer(val p: JSONObject, val afterSign: () -> Unit) :
    NativeWithdrawalSigner {
    private var payload = ""

    override fun prepare(
      revision: ULong,
      credit: NativeEarnReturnedCreditProof,
      quote: NativeEarnWithdrawalQuoteBinding,
      payload: String,
      journal: NativeEarnPayoutJournalEvidence,
    ): String {
      this.payload = payload
      assertEquals("return1", credit.returnOperationId)
      assertEquals("withdrawal", journal.leg)
      return "Native return credit -> fresh public R"
    }

    override fun reviewHash() = f.hash

    override fun approve(revision: ULong, hash: String) {}

    override fun sign(
      revision: ULong,
      journal: NativeEarnPayoutJournalEvidence,
    ): NativeSignedEarnPayout {
      signs++
      afterSign()
      return NativeSignedEarnPayout(
        "withdraw1",
        revision,
        1uL,
        "withdrawal",
        f.hash,
        "erc191",
        payload,
        "secp256k1:private-signature",
        f.nativeHash,
        f.hash,
        f.nonce,
      )
    }

    override fun close() {}
  }

  private fun engine(
    j: EarnWithdrawalJournal,
    afterSign: () -> Unit = {},
    allowSign: Boolean = true,
    history: JSONObject? = null,
    chain: TransferRpc =
      object : TransferRpc {
        override suspend fun call(method: String, params: JSONArray): Any = error("Unexpected RPC")
      },
  ): EarnWithdrawalEngine {
    val gateway =
      NativeWithdrawalGateway(
        post = { endpoint, body ->
          when (endpoint) {
            "submit" -> {
              submissions.add(body)
              error("Unknown send")
            }
            "settlement" -> checkNotNull(history).toString()
            else -> error("Unexpected endpoint")
          }
        },
        bodyHash = { f.nativeHash },
        now = { f.now },
      )
    return EarnWithdrawalEngine(
      store(),
      j,
      chain,
      gateway,
      sourceReader = { _, _ -> error("No new return on retry") },
      readAuth = { EarnReadAuthentication("native empty intents", "read signature") },
      signerFactory = { p, _, _ ->
        check(allowSign)
        Signer(JSONObject(p), afterSign)
      },
      identities = { _, _ -> PayoutIdentities(f.owner, f.C, f.recipient) },
      now = { f.now },
      eventTopic = { f.nativeHash },
    )
  }

  private fun journal(file: File) = EarnWithdrawalJournal(file, { key }, f.wallet, f.wallet)

  private fun create(j: EarnWithdrawalJournal) =
    j.create(proposal(), withdrawalPrepared().toString(), f.nonce, f.nativeHash, f.hash, "source")
      .getString("operationId")

  @Test
  fun lostSubmissionRestartsWithIdenticalSavedBytesAndSeparateApproval(): Unit = runBlocking {
    val file = File()
    val j = journal(file)
    val id = create(j)
    engine(j).use { e ->
      val review = e.prepare(id, 1)
      assertEquals(0, signs)
      assertThrows(IllegalStateException::class.java) { runBlocking { e.execute(review) {} } }
    }
    assertEquals(1, signs)
    assertEquals(1, submissions.size)
    assertTrue(j.get(id).has("signedData"))
    engine(journal(file), allowSign = false).use { e ->
      val review = e.prepare(id, j.get(id).getInt("revision"))
      assertTrue(review.retry)
      assertThrows(IllegalStateException::class.java) {
        runBlocking { e.execute(review) { error("No approval") } }
      }
      assertEquals(1, submissions.size)
      assertThrows(IllegalStateException::class.java) { runBlocking { e.execute(review) {} } }
    }
    assertEquals(1, signs)
    assertEquals(2, submissions.size)
    assertEquals(submissions[0], submissions[1])
    assertFalse(j.public(j.get(id)).toString().contains("private-signature"))
  }

  @Test
  fun failedSignatureSaveCannotSubmitOrReleaseChild(): Unit = runBlocking {
    val file = File()
    val j = journal(file)
    val id = create(j)
    engine(j, afterSign = { file.fail = true }).use { e ->
      val review = e.prepare(id, 1)
      assertThrows(IllegalStateException::class.java) { runBlocking { e.execute(review) {} } }
    }
    assertEquals(1, signs)
    assertEquals(0, submissions.size)
    file.fail = false
    assertTrue(j.get(id).getBoolean("signingAuthorizationPending"))
    assertFalse(j.get(id).has("signedData"))
    assertThrows(IllegalStateException::class.java) {
      j.cancelUnsigned(id, j.get(id).getInt("revision"))
    }
  }

  private fun delivered() =
    JSONObject()
      .put("operationId", "withdraw1")
      .put("revision", 1)
      .put("leg", "withdrawal")
      .put("quoteId", f.hash)
      .put("authenticated", true)
      .put("operationScoped", true)
      .put("observedAtMs", f.now)
      .put("expiresAtMs", f.now + 60000)
      .put("confidentialAccount", f.C)
      .put("destinationChainId", 143)
      .put("destinationRecipient", f.recipient)
      .put("destinationToken", MONAD_EARN_USDC)
      .put("minimumDestinationAtoms", "1")
      .put("receivedAtoms", "100")
      .put("status", "delivered")
      .put("destinationTransactionHash", f.hash)

  private fun receiptRpc(value: String = "100", finalized: String = "0xc") =
    object : TransferRpc {
      override suspend fun call(method: String, params: JSONArray): Any =
        when (method) {
          "eth_chainId" -> "0x8f"
          "eth_getBlockByNumber" ->
            when (params.getString(0)) {
              "0xa" -> JSONObject().put("number", "0xa").put("hash", f.hash)
              "0xb" ->
                JSONObject()
                  .put("number", "0xb")
                  .put("hash", f.nativeHash)
                  .put("timestamp", "0x3e8")
              "finalized" -> JSONObject().put("number", finalized).put("hash", f.hash)
              else -> error("Unexpected block")
            }
          "eth_getTransactionReceipt" ->
            JSONObject()
              .put("status", "0x1")
              .put("transactionHash", f.hash)
              .put("blockNumber", "0xb")
              .put("blockHash", f.nativeHash)
              .put(
                "logs",
                JSONArray()
                  .put(
                    JSONObject()
                      .put("address", MONAD_EARN_USDC)
                      .put(
                        "topics",
                        JSONArray()
                          .put(f.nativeHash)
                          .put("0x" + "0".repeat(64))
                          .put("0x" + earnAddressWord(f.recipient)),
                      )
                      .put("data", "0x" + earnNumberWord(value))
                  ),
              )
          else -> error("Unexpected RPC $method")
        }
    }

  @Test
  fun authenticatedWithdrawalCreditAndCanonicalFinalMonadReceiptUnlockPaid(): Unit = runBlocking {
    val j = journal(File())
    val id = create(j)
    engine(j, history = delivered(), chain = receiptRpc()).use { e ->
      try {
        e.execute(e.prepare(id, 1)) {}
      } catch (_: IllegalStateException) {}
      val paid = e.reconcile(id, j.get(id).getInt("revision"))
      assertEquals("paid", j.public(paid)["status"])
      assertEquals("100", j.public(paid)["receivedAtoms"])
      assertEquals(false, j.public(paid)["blocked"])
    }
  }

  @Test
  fun unscopedCreditWrongReceiptAndUnfinalizedMonadBlockKeepChildLocked(): Unit = runBlocking {
    for (variant in 0..2) {
      val j = journal(File())
      val id = create(j)
      val history = delivered()
      if (variant == 0) history.put("operationScoped", false)
      engine(
          j,
          history = history,
          chain = receiptRpc(if (variant == 1) "99" else "100", if (variant == 2) "0xa" else "0xc"),
        )
        .use { e ->
          try {
            e.execute(e.prepare(id, 1)) {}
          } catch (_: IllegalStateException) {}
          assertThrows(IllegalStateException::class.java) {
            runBlocking { e.reconcile(id, j.get(id).getInt("revision")) }
          }
        }
      assertEquals("unknown", j.public(j.get(id))["status"])
      assertEquals("0", j.public(j.get(id))["receivedAtoms"])
      assertTrue(j.get(id).has("signedData"))
    }
  }
}
