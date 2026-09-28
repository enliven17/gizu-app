package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.NativeSignedTransfer

class OperationJournalTest {
  private val walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private val from = "0x" + "1".repeat(40)
  private val to = "0x" + "2".repeat(40)
  private val hash = "0x" + "a".repeat(64)

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

  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
  private val archives = mutableMapOf<String, ByteArray>()

  private fun journal(file: File) =
    OperationJournal(file, { key }, walletId, walletId) { id, bytes -> archives[id] = bytes }

  private fun steps(count: Int = 1) =
    JSONArray(
      (0 until count).map { index ->
        JSONObject()
          .put("index", index)
          .put("accountIndex", 0)
          .put("from", from)
          .put("to", to)
          .put("valueWei", "1000")
          .put("nonce", index.toString())
          .put("status", "planned")
          .put(
            "quote",
            JSONObject().put("gas", "0x5208").put("maxFee", "0x1").put("priorityFee", "0x0"),
          )
      }
    )

  private fun signed() = NativeSignedTransfer("0x02abcdef", hash, "0x" + "b".repeat(64), from, "0")

  private inner class Rpc : TransferRpc {
    val sent = mutableListOf<String>()
    var failSend = false
    var nonce = "0x0"
    var receipt: Any = JSONObject.NULL
    var transaction: Any = JSONObject.NULL

    override suspend fun call(method: String, params: JSONArray): Any =
      when (method) {
        "eth_chainId" -> "0x279f"
        "eth_getTransactionReceipt" -> receipt
        "eth_getTransactionByHash" -> transaction
        "eth_getTransactionCount" -> nonce
        "eth_getCode" -> "0x"
        "eth_getBalance" -> "0xde0b6b3a7640000"
        "eth_getBlockByNumber" -> JSONObject().put("hash", "0xblock").put("number", "0xa")
        "eth_sendRawTransaction" -> {
          sent.add(params.getString(0))
          if (failSend) error("lost response")
          hash
        }
        else -> error("Unexpected read")
      }
  }

  @Test
  fun encryptedRestartAndPublicAllowlist() =
    runBlocking<Unit> {
      val file = File()
      val journal = journal(file)
      val op = journal.create(steps())
      val rpc = Rpc()
      persistAndBroadcast(journal, rpc, op.getString("operationId"), 0, signed()) {}
      assertFalse(String(file.bytes!!).contains("0x02abcdef"))
      val restarted = journal(file)
      val restored = restarted.get(op.getString("operationId"))
      assertEquals("0x02abcdef", restored.steps()[0].getString("raw"))
      val public = restarted.public(restored)
      assertFalse(public.toString().contains("0x02abcdef"))
      assertFalse(public.toString().contains("quote"))
      assertTrue(public["blocked"] as Boolean)
    }

  @Test
  fun failedPersistenceNeverBroadcasts() =
    runBlocking<Unit> {
      val file = File()
      val journal = journal(file)
      val id = journal.create(steps()).getString("operationId")
      val rpc = Rpc()
      file.fail = true
      try {
        persistAndBroadcast(journal, rpc, id, 0, signed()) {}
        fail("Expected write failure")
      } catch (_: IllegalStateException) {}
      assertTrue(rpc.sent.isEmpty())
      assertEquals("planned", journal.get(id).steps()[0].getString("status"))
    }

  @Test
  fun lostResponseAndReadOnlyRefreshAllowOnlyExplicitIdenticalByteRetry() =
    runBlocking<Unit> {
      val file = File()
      val journal = journal(file)
      val id = journal.create(steps()).getString("operationId")
      val rpc = Rpc().apply { failSend = true }
      try {
        persistAndBroadcast(journal, rpc, id, 0, signed()) {}
        fail("Expected network failure")
      } catch (_: IllegalStateException) {}
      assertEquals("unknown", journal.get(id).steps()[0].getString("status"))
      reconcileOperations(journal, rpc)
      assertEquals(1, rpc.sent.size)
      assertTrue(journal.get(id).resumable())
      // Retry preparation/execution never loads entropy or signs again.
      val noWallet =
        WalletStore(
          File(),
          object : WalletKeys {
            override fun existing() = key

            override fun create() = key

            override fun reset() = key
          },
        )
      TransferEngine(noWallet, journal, rpc).use { engine ->
        val review = engine.prepare(id, journal.get(id).getInt("revision"))
        assertTrue(review.retry)
        assertTrue(review.text.contains("Nonce 0"))
        rpc.failSend = false
        engine.execute(review) {}
      }
      assertEquals(listOf("0x02abcdef", "0x02abcdef"), rpc.sent)
    }

  @Test
  fun nonceConflictNeverRetriesOrUnblocksAfterCancel() =
    runBlocking<Unit> {
      val journal = journal(File())
      val id = journal.create(steps(2)).getString("operationId")
      val rpc = Rpc()
      persistAndBroadcast(journal, rpc, id, 0, signed()) {}
      rpc.nonce = "0x1"
      reconcileOperations(journal, rpc)
      assertFalse(journal.get(id).resumable())
      assertTrue(journal.get(id).steps()[0].getBoolean("conflict"))
      journal.cancel(id)
      assertTrue(journal.get(id).blocked())
      assertEquals(1, rpc.sent.size)
      assertThrows(IllegalStateException::class.java) { journal.create(steps()) }
    }

  @Test
  fun finalReceiptReconcilesWithoutRepeatingAndUnsignedCancellationUnblocks() =
    runBlocking<Unit> {
      val journal = journal(File())
      val id = journal.create(steps(2)).getString("operationId")
      val rpc = Rpc()
      persistAndBroadcast(journal, rpc, id, 0, signed()) {}
      rpc.receipt =
        JSONObject()
          .put("transactionHash", hash)
          .put("from", from)
          .put("to", to)
          .put("blockNumber", "0x9")
          .put("blockHash", "0xblock")
          .put("status", "0x1")
      reconcileOperations(journal, rpc)
      assertEquals("finalized", journal.get(id).steps()[0].getString("status"))
      assertTrue(journal.get(id).resumable())
      assertEquals(1, rpc.sent.size)
      journal.cancel(id)
      assertFalse(journal.get(id).blocked())
      assertFalse(journal.get(id).resumable())
      journal.create(steps())
    }

  @Test
  fun staleRevisionCannotMutateAndDifferentRestoredGenerationCannotReadOldJournal() {
    val file = File()
    val journal = journal(file)
    val op = journal.create(steps())
    val id = op.getString("operationId")
    journal.cancel(id)
    assertThrows(IllegalStateException::class.java) {
      journal.update(id, 1) { it.put("cancelled", false) }
    }
    val other =
      OperationJournal(file, { key }, walletId, "7aafcc2e-0891-4e31-a7d4-03780d7b4f13") { _, _ ->
        error("Unexpected archive")
      }
    assertThrows(Exception::class.java) { other.all() }
  }

  @Test
  fun cancellationAfterDurableSigningPreventsSendButKeepsRetryEvidence() =
    runBlocking<Unit> {
      val journal = journal(File())
      val id = journal.create(steps()).getString("operationId")
      val rpc = Rpc()
      try {
        persistAndBroadcast(journal, rpc, id, 0, signed()) { error("cancelled") }
        fail("Expected cancellation")
      } catch (_: IllegalStateException) {}
      assertTrue(rpc.sent.isEmpty())
      assertEquals("0x02abcdef", journal.get(id).steps()[0].getString("raw"))
    }

  @Test
  fun knownPendingTransactionIsNeverOfferedForRetry() =
    runBlocking<Unit> {
      val journal = journal(File())
      val id = journal.create(steps()).getString("operationId")
      val rpc = Rpc()
      persistAndBroadcast(journal, rpc, id, 0, signed()) {}
      rpc.transaction = JSONObject().put("hash", hash).put("from", from).put("nonce", "0x0")
      reconcileOperations(journal, rpc)
      assertEquals("pending", journal.get(id).steps()[0].getString("status"))
      assertFalse(journal.get(id).resumable())
      assertEquals(1, rpc.sent.size)
    }

  @Test
  fun expoNumericMapsRequireExactIntegerIndicesAndChain() {
    fun request(index: Any, chain: Any = 10143.0) =
      mapOf<String, Any?>(
        "walletId" to walletId,
        "chainId" to chain,
        "transfers" to
          listOf(
            mapOf("accountIndex" to index, "expectedFrom" to from, "to" to to, "valueWei" to "1000")
          ),
      )
    val parsed = canonicalProposal(walletId, request(0.0))
    assertEquals(10143, parsed.get("chainId"))
    assertEquals(0, parsed.getJSONArray("transfers").getJSONObject(0).get("accountIndex"))
    for (index in listOf(0.5, 16.0, -1.0, "0")) assertThrows(Exception::class.java) {
      canonicalProposal(walletId, request(index))
    }
    assertThrows(Exception::class.java) { canonicalProposal(walletId, request(0.0, 1.0)) }
  }

  @Test
  fun cancelledUnsignedReviewsDoNotConsumeCapacity() {
    val journal = journal(File())
    repeat(260) { journal.cancel(journal.create(steps()).getString("operationId")) }
    assertEquals(1, journal.all().size)
    assertTrue(archives.isEmpty())
    journal.create(steps())
  }

  @Test
  fun archivesOldestSettledBeforeAcceptingMoreOperations() {
    val file = File()
    val journal = journal(file)
    var first = ""
    repeat(256) { index ->
      val id = journal.create(steps()).getString("operationId")
      if (index == 0) first = id
      journal.update(id) {
        it
          .steps()[0]
          .put("raw", "0x02abcdef")
          .put("transactionHash", hash)
          .put("status", "finalized")
      }
    }
    val before = file.bytes!!.copyOf()
    val failArchive =
      OperationJournal(file, { key }, walletId, walletId) { _, _ -> error("Archive write failed") }
    assertThrows(IllegalStateException::class.java) { failArchive.create(steps()) }
    assertArrayEquals(before, file.bytes)
    file.fail = true
    assertThrows(IllegalStateException::class.java) { journal.create(steps()) }
    assertArrayEquals(before, file.bytes)
    assertTrue(archives.containsKey(first))
    file.fail = false
    journal.create(steps())
    assertEquals(256, journal.all().size)
    assertFalse(journal.all().any { it.getString("operationId") == first })
    val archived =
      CryptoEnvelope.decrypt(
        key,
        archives.getValue(first),
        "gizu-stored-operations:v1:$walletId:$walletId".toByteArray(),
      )
    assertEquals(
      first,
      JSONObject(String(archived))
        .getJSONArray("operations")
        .getJSONObject(0)
        .getString("operationId"),
    )
  }

  @Test
  fun unresolvedCancelledSignatureIsNeverCompacted() =
    runBlocking<Unit> {
      val journal = journal(File())
      val id = journal.create(steps()).getString("operationId")
      persistAndBroadcast(journal, Rpc(), id, 0, signed()) {}
      journal.cancel(id)
      assertThrows(IllegalStateException::class.java) { journal.create(steps()) }
      assertEquals("0x02abcdef", journal.get(id).steps()[0].getString("raw"))
      assertTrue(archives.isEmpty())
    }

  @Test
  fun commitFailuresPreventBroadcastEvenWhenRenameAlreadyHappened() =
    runBlocking<Unit> {
      for (failure in listOf("sync", "close", "rename", "directory", "readback", "silentRename")) {
        val backing = File()
        var inject = false
        val durable =
          object : WalletFile {
            override fun exists() = backing.exists()

            override fun read() = backing.read()

            override fun write(bytes: ByteArray) {
              commitWalletFile(
                bytes,
                object : WalletFileCommit {
                  override fun writeAndSync(bytes: ByteArray) {
                    if (inject && failure in listOf("sync", "close")) error(failure)
                  }

                  override fun replace() {
                    if (inject && failure == "rename") error(failure)
                    if (!(inject && failure == "silentRename")) backing.write(bytes)
                  }

                  override fun syncParent() {
                    if (inject && failure == "directory") error(failure)
                  }

                  override fun readCommitted(): ByteArray {
                    if (inject && failure == "readback") return byteArrayOf()
                    return backing.read()
                  }

                  override fun discardPending() {}
                },
              )
            }
          }
        val journal =
          OperationJournal(durable, { key }, walletId, walletId) { _, _ ->
            error("Unexpected archive")
          }
        val id = journal.create(steps()).getString("operationId")
        val rpc = Rpc()
        inject = true
        try {
          persistAndBroadcast(journal, rpc, id, 0, signed()) {}
          fail("Expected $failure")
        } catch (_: Exception) {
          /* Failed storage must never reach network submission. */
        }
        assertTrue(failure, rpc.sent.isEmpty())
        val saved = journal.get(id).steps()[0]
        if (failure in listOf("directory", "readback"))
          assertEquals("0x02abcdef", saved.getString("raw"))
        else assertEquals("planned", saved.getString("status"))
      }
    }

  @Test
  fun archivesSettledHistoryBeforeByteCapacityIsExhausted() {
    val journal = journal(File())
    val id = journal.create(steps()).getString("operationId")
    journal.update(id) {
      it.steps()[0].put("raw", "0x02abcdef").put("transactionHash", hash).put("status", "finalized")
      it.put("padding", "x".repeat(3 * 1024 * 1024))
    }
    journal.create(steps())
    assertEquals(1, journal.all().size)
    assertTrue(archives.containsKey(id))
  }
}
