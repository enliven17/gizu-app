package io.gizu.storedwallet

import android.content.Context
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.*

private const val JOURNAL_FILE_LIMIT_BYTES = 4 * 1024 * 1024
private const val NATIVE_TRANSFER_GAS = 21000L
private const val FINALITY_POLL_ATTEMPTS = 3
private const val FINALITY_POLL_INTERVAL_MS = 1000L
private val MAX_OPERATION_FEE_WEI = "100000000000000000".toBigInteger()

internal fun operationJournal(context: Context, record: WalletRecord): OperationJournal {
  check(record.verified)
  return OperationJournal(
    AndroidWalletFile(context, "gizu-operations-${record.journalId}.enc", JOURNAL_FILE_LIMIT_BYTES),
    { checkNotNull(AndroidWalletKeys().existing()) },
    record.id,
    record.journalId,
  ) { id, bytes ->
    AndroidWalletFile(
        context,
        "gizu-operations-${record.journalId}-archive-$id.enc",
        JOURNAL_FILE_LIMIT_BYTES,
      )
      .write(bytes)
  }
}

internal fun canonicalProposal(walletId: String, request: Map<String, Any?>): JSONObject {
  check(request.keys == setOf("walletId", "chainId", "transfers"))
  check(request["walletId"] == walletId)
  val proposal =
    JSONObject(request).apply {
      remove("walletId")
      put("kind", "nativeTransfers")
    }
  // Expo'step generic map represents JS numbers as Double. Canonicalize only exact integers.
  check((proposal.get("chainId") as? Number)?.toDouble() == 10143.0)
  proposal.put("chainId", 10143)
  val incoming = proposal.getJSONArray("transfers")
  for (i in 0 until incoming.length()) {
    val row = incoming.getJSONObject(i)
    val index = row.get("accountIndex") as? Number ?: error("Invalid index")
    check(
      index.toDouble().isFinite() &&
        index.toDouble() == index.toInt().toDouble() &&
        index.toInt() in 0..15
    )
    row.put("accountIndex", index.toInt())
  }
  return proposal
}

internal fun createOperation(
  journal: OperationJournal,
  record: WalletRecord,
  request: Map<String, Any?>,
): JSONObject {
  check(record.verified)
  val proposal = canonicalProposal(record.id, request)
  validateTransferProposal(proposal.toString())
  val addresses = deriveAccountAddresses(record.entropy)
  val rows = proposal.getJSONArray("transfers")
  val steps = JSONArray()
  for (i in 0 until rows.length()) {
    val row = rows.getJSONObject(i)
    val index = row.getInt("accountIndex")
    check(row.getString("expectedFrom").equals(addresses[index], true))
    steps.put(
      JSONObject()
        .put("index", i)
        .put("accountIndex", index)
        .put("from", addresses[index])
        .put("to", row.getString("to"))
        .put("valueWei", row.getString("valueWei"))
        .put("status", "planned")
    )
  }
  return journal.create(steps)
}

internal data class PreparedReview(
  val id: String,
  val revision: Int,
  val text: String,
  val indices: List<Int>,
  val retry: Boolean,
)

/**
 * Native-private engine. Approval and passkey verification are supplied only by TransferActivity.
 */
internal class TransferEngine(
  private val store: WalletStore,
  val journal: OperationJournal,
  private val rpc: TransferRpc,
) : AutoCloseable {
  private var signer: TransferOperation? = null

  suspend fun prepare(id: String, expectedRevision: Int): PreparedReview {
    check(journal.get(id).getInt("revision") == expectedRevision)
    reconcileOperations(journal, rpc)
    val operation = journal.get(id)
    check(operation.resumable()) { "Reconcile pending transfers before resume" }
    val raw =
      operation.steps().firstOrNull { it.has("raw") && it.getString("status") !in terminalSteps }
    if (raw != null) {
      check(raw.getString("status") == "signed" && !raw.optBoolean("conflict"))
      checkRetry(raw)
      return PreparedReview(
        id,
        operation.getInt("revision"),
        retryReview(raw),
        listOf(raw.getInt("index")),
        true,
      )
    }
    check(!operation.getBoolean("cancelled"))
    val steps = operation.steps().filter { it.getString("status") == "planned" }
    check(steps.isNotEmpty())
    val chain = rpc.text("eth_chainId")
    val fee = rpc.text("eth_gasPrice")
    val priority = rpc.text("eth_maxPriorityFeePerGas")
    val quotes = fetchQuotes(steps, chain, fee, priority)
    val spentFee =
      operation
        .steps()
        .filter { it.has("raw") }
        .fold(java.math.BigInteger.ZERO) { total, step ->
          total +
            quantity(step.getJSONObject("quote").getString("maxFee")) *
              NATIVE_TRANSFER_GAS.toBigInteger()
        }
    check(
      spentFee + quantity(fee) * (NATIVE_TRANSFER_GAS * steps.size).toBigInteger() <=
        MAX_OPERATION_FEE_WEI
    )
    val proposal =
      JSONObject()
        .put("kind", "nativeTransfers")
        .put("chainId", 10143)
        .put(
          "transfers",
          JSONArray(
            steps.map { step ->
              JSONObject()
                .put("accountIndex", step.getInt("accountIndex"))
                .put("expectedFrom", step.getString("from"))
                .put("to", step.getString("to"))
                .put("valueWei", step.getString("valueWei"))
            }
          ),
        )
    currentCoroutineContext().ensureActive()
    signer =
      store.load().use { record ->
        check(record.verified && record.id == journal.walletId)
        TransferOperation(proposal.toString(), record.entropy)
      }
    val review = signer!!.prepare(quotes)
    val occurrences = mutableMapOf<String, Int>()
    val updated =
      journal.update(id, operation.getInt("revision")) { target ->
        steps.zip(quotes).forEach { (step, quote) ->
          val from = step.getString("from")
          val offset = occurrences[from] ?: 0
          occurrences[from] = offset + 1
          val nonce = (quantity(quote.nonce) + offset.toBigInteger()).toString()
          val targetStep = target.getJSONArray("steps").getJSONObject(step.getInt("index"))
          targetStep
            .put("nonce", nonce)
            .put(
              "quote",
              JSONObject()
                .put("gas", quote.gas)
                .put("maxFee", quote.maxFee)
                .put("priorityFee", quote.priorityFee),
            )
        }
      }
    return PreparedReview(
      id,
      updated.getInt("revision"),
      "${steps.size} remaining transfer(s). Previously completed transfers will not repeat.\n\n$review",
      steps.map { it.getInt("index") },
      false,
    )
  }

  private suspend fun fetchQuotes(
    steps: List<JSONObject>,
    chain: String,
    fee: String,
    priority: String,
  ): List<TransferQuote> {
    val nonces = mutableMapOf<String, String>()
    val balances = mutableMapOf<String, String>()
    return steps.map { step ->
      val from = step.getString("from")
      val to = step.getString("to")
      val nonce =
        nonces[from]
          ?: rpc.text("eth_getTransactionCount", from, "pending").also { nonces[from] = it }
      val balance =
        balances[from] ?: rpc.text("eth_getBalance", from, "pending").also { balances[from] = it }
      val values =
        steps
          .filter { it.getString("from") == from }
          .map { "0x" + it.getString("valueWei").toBigInteger().toString(16) }
      requireTransferBalance(balance, values, fee)
      val value = "0x" + step.getString("valueWei").toBigInteger().toString(16)
      val gas =
        rpc.call(
          "eth_estimateGas",
          JSONArray()
            .put(JSONObject().put("from", from).put("to", to).put("value", value).put("data", "0x")),
        ) as String
      TransferQuote(
        chain,
        nonce,
        gas,
        fee,
        priority,
        balance,
        rpc.text("eth_getCode", to, "pending"),
        rpc.text("eth_getCode", from, "pending"),
      )
    }
  }

  private fun retryReview(step: JSONObject): String {
    val quote = step.getJSONObject("quote")
    return "MONAD TESTNET · chain 10143\n" +
      "Retry the exact previously signed transaction. No new signature or fee replacement.\n" +
      "\n" +
      "Account ${step.getInt("accountIndex")}\n" +
      "From ${step.getString("from")}\n" +
      "To ${step.getString("to")}\n" +
      "Amount ${step.getString("valueWei")} wei\n" +
      "Nonce ${step.getString("nonce")}\n" +
      "Gas ${quantity(quote.getString("gas"))}\n" +
      "Max fee/gas ${quantity(quote.getString("maxFee"))} wei\n" +
      "Priority/gas ${quantity(quote.getString("priorityFee"))} wei\n" +
      "Maximum fee ${quantity(quote.getString("maxFee"))*NATIVE_TRANSFER_GAS.toBigInteger()} wei\n" +
      "Hash ${step.getString("transactionHash")}\n" +
      "\n" +
      "Only this saved transaction will be retried. Refresh status before resuming any remaining steps."
  }

  private suspend fun checkRetry(step: JSONObject) {
    check(quantity(rpc.text("eth_chainId")) == 10143.toBigInteger())
    check(
      quantity(rpc.text("eth_getTransactionCount", step.getString("from"), "pending")) ==
        step.getString("nonce").toBigInteger()
    )
    check(
      quantity(rpc.text("eth_getTransactionCount", step.getString("from"), "latest")) ==
        step.getString("nonce").toBigInteger()
    )
    check(
      rpc.text("eth_getCode", step.getString("from"), "pending") == "0x" &&
        rpc.text("eth_getCode", step.getString("to"), "pending") == "0x"
    )
    requireTransferBalance(
      rpc.text("eth_getBalance", step.getString("from"), "pending"),
      listOf("0x" + step.getString("valueWei").toBigInteger().toString(16)),
      step.getJSONObject("quote").getString("maxFee"),
    )
  }

  suspend fun execute(review: PreparedReview, checkAuthority: () -> Unit) {
    check(journal.get(review.id).getInt("revision") == review.revision)
    checkAuthority()
    currentCoroutineContext().ensureActive()
    if (review.retry) {
      retrySavedTransaction(review, checkAuthority)
      return
    }
    val core = checkNotNull(signer)
    core.approve()
    for (index in review.indices) {
      checkAuthority()
      currentCoroutineContext().ensureActive()
      val step = journal.get(review.id).steps()[index]
      check(step.getString("status") == "planned")
      val chain = rpc.text("eth_chainId")
      val nonce = rpc.text("eth_getTransactionCount", step.getString("from"), "pending")
      val code = rpc.text("eth_getCode", step.getString("to"), "pending")
      val senderCode = rpc.text("eth_getCode", step.getString("from"), "pending")
      checkAuthority()
      currentCoroutineContext().ensureActive()
      val transaction = core.signNext(nonce, chain, code, senderCode)
      persistAndBroadcast(journal, rpc, review.id, index, transaction, checkAuthority)
      reconcileOperations(journal, rpc)
      repeat(FINALITY_POLL_ATTEMPTS) {
        if (journal.get(review.id).steps()[index].getString("status") !in terminalSteps) {
          kotlinx.coroutines.delay(FINALITY_POLL_INTERVAL_MS)
          checkAuthority()
          reconcileOperations(journal, rpc)
        }
      }
      // No automatic retry, and no later step until this one is finalized.
      if (journal.get(review.id).steps()[index].getString("status") != "finalized") break
    }
  }

  private suspend fun retrySavedTransaction(review: PreparedReview, checkAuthority: () -> Unit) {
    val step = journal.get(review.id).steps()[review.indices.single()]
    checkRetry(step)
    checkAuthority()
    currentCoroutineContext().ensureActive()
    // An uncertain send stays unknown; refresh never invokes this path.
    journal.update(review.id, review.revision) {
      it.steps()[step.getInt("index")].put("status", "unknown")
    }
    val returned = rpc.text("eth_sendRawTransaction", step.getString("raw"))
    check(returned.equals(step.getString("transactionHash"), true))
    reconcileOperations(journal, rpc)
  }

  override fun close() {
    signer?.invalidate()
    signer?.destroy()
    signer = null
  }
}

internal suspend fun persistAndBroadcast(
  journal: OperationJournal,
  rpc: TransferRpc,
  id: String,
  index: Int,
  transaction: NativeSignedTransfer,
  checkAuthority: () -> Unit,
) {
  journal.update(id) { operation ->
    val step = operation.steps()[index]
    check(!operation.getBoolean("cancelled") && step.getString("status") == "planned")
    check(
      transaction.from.equals(step.getString("from"), true) &&
        transaction.nonce == step.getString("nonce")
    )
    step
      .put("raw", transaction.rawTransaction)
      .put("transactionHash", transaction.transactionHash)
      .put("status", "unknown")
  }
  currentCoroutineContext().ensureActive()
  checkAuthority()
  val returned = rpc.text("eth_sendRawTransaction", transaction.rawTransaction)
  check(returned.equals(transaction.transactionHash, true))
}
