package io.gizu.storedwallet.swap

import android.util.Log
import io.gizu.storedwallet.NativeRpcTransport
import io.gizu.storedwallet.RpcFailure
import io.gizu.storedwallet.WalletRecord
import io.gizu.storedwallet.WalletStore
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.SwapOperation
import uniffi.gizu_stored_signer_core.SwapStep
import uniffi.gizu_stored_signer_core.allocateSwapRecipients
import uniffi.gizu_stored_signer_core.deriveAccountAddressRange
import uniffi.gizu_stored_signer_core.planRecipientCount

internal sealed class SwapUi {
  data class Review(val text: String) : SwapUi()

  data object Unlock : SwapUi()

  data class Done(val view: Map<String, Any?>) : SwapUi()
}

internal class SwapEngine(
  private val store: WalletStore,
  private val saved: SwapStore,
  private val gateway: String,
  private val transport: NativeRpcTransport = NativeRpcTransport(),
) : AutoCloseable {
  private var operation: SwapOperation? = null
  private var fundingAddress: String? = null

  /** `confidentialPayout` buys from C's existing private balance and takes no amount. */
  fun start(
    record: WalletRecord,
    target: String,
    amountAtoms: String?,
    kind: String = "confidentialSwap",
  ) {
    check(kind == "confidentialSwap" || (kind == "confidentialPayout" && amountAtoms == null))
    check(record.verified && record.id == saved.walletId)
    check(operation == null)
    saved.load()?.let { existing ->
      val previous = SwapOperation.restore(existing.getString("state"), gateway)
      val phase = JSONObject(previous.publicStatus()).getString("phase")
      if (phase != "CANCELLED" && phase != "COMPLETE") {
        fundingAddress = existing.getString("fundingAddress")
        operation = previous
        previous.retry()
        return
      }
      saved.portfolio.remember(existing.getString("state"), previous.publicStatus())
      previous.close()
    }
    check(target.matches(Regex("0x[0-9a-fA-F]{40}")))
    if (amountAtoms != null)
      check(amountAtoms.matches(Regex("[1-9][0-9]{0,8}")) && amountAtoms.toLong() <= 10_000_000L)
    // The private balance a payout spends is unknown until Aurora reports it, so its recipient
    // count uses the plain low-amount rule (a requested amount always uses the real amount).
    val count = planRecipientCount(amountAtoms ?: "0")
    val reserved = allocateSwapRecipients(record.roleRegistry, count)
    store.persistRegistry(record.id, reserved.registry)
    val plan =
      JSONObject()
        .put("kind", kind)
        .put("target", target)
        .put("recipientIndices", JSONArray(reserved.indices.map { it.toInt() }))
    if (amountAtoms != null) plan.put("amountAtoms", amountAtoms)
    fundingAddress = deriveAccountAddressRange(record.entropy, 1u, 1u).single()
    operation = SwapOperation.start(plan.toString(), record.entropy, gateway, now())
    persist()
  }

  /** Temporary: finish Fusion buys for already allocated recipients that still hold USDG. */
  fun startRecovery(record: WalletRecord, target: String) {
    check(record.verified && record.id == saved.walletId)
    check(operation == null)
    saved.load()?.let { existing ->
      val previous = SwapOperation.restore(existing.getString("state"), gateway)
      val phase = JSONObject(previous.publicStatus()).getString("phase")
      if (phase != "CANCELLED" && phase != "COMPLETE") {
        fundingAddress = existing.getString("fundingAddress")
        operation = previous
        previous.retry()
        return
      }
      saved.portfolio.remember(existing.getString("state"), previous.publicStatus())
      previous.close()
    }
    check(target.matches(Regex("0x[0-9a-fA-F]{40}")))
    // Scans indices the registry already handed out; nothing new is reserved.
    val scanTo = JSONObject(record.roleRegistry).getInt("nextRecipient")
    val plan =
      JSONObject()
        .put("kind", "confidentialRecovery")
        .put("target", target)
        .put("recipientIndices", JSONArray(listOf(3, 4, 5)))
        .put("scanTo", scanTo)
    fundingAddress = deriveAccountAddressRange(record.entropy, 1u, 1u).single()
    operation = SwapOperation.start(plan.toString(), record.entropy, gateway, now())
    persist()
  }

  fun startSell(record: WalletRecord, holdingId: String? = null) {
    check(record.verified && record.id == saved.walletId)
    check(operation == null)
    val existing = saved.load()
    if (existing != null) {
      val previous = SwapOperation.restore(existing.getString("state"), gateway)
      try {
        val phase = JSONObject(previous.publicStatus()).getString("phase")
        check(phase == "CANCELLED" || phase == "COMPLETE") {
          "An existing swap needs attention. Open Swap and resume it before selling holdings."
        }
        saved.portfolio.remember(existing.getString("state"), previous.publicStatus())
      } finally {
        previous.close()
      }
    }
    val (target, holders) =
      if (holdingId != null) {
        val selected =
          SwapHoldings.selection(
            holdingId,
            JSONObject(record.roleRegistry).getInt("nextRecipient"),
            saved.portfolio.targets(),
          )
        selected.first to JSONArray(selected.second)
      } else {
        val state = JSONObject(checkNotNull(existing).getString("state"))
        val plan = state.getJSONObject("plan")
        check(plan.getString("kind") in listOf("confidentialSwap", "confidentialPayout"))
        val previous = SwapOperation.restore(existing.getString("state"), gateway)
        try {
          check(JSONObject(previous.publicStatus()).getString("phase") == "COMPLETE")
        } finally {
          previous.close()
        }
        plan.getString("target") to plan.getJSONArray("recipientIndices")
      }
    // One fresh return wallet per holding wallet; not the amount-tiered count (there is no
    // new swap amount here, just reversing however many wallets already hold the position).
    val reserved = allocateSwapRecipients(record.roleRegistry, holders.length().toUInt())
    store.persistRegistry(record.id, reserved.registry)
    val next =
      JSONObject()
        .put("kind", "confidentialSell")
        .put("target", target)
        .put("holderIndices", holders)
        .put("recipientIndices", JSONArray(reserved.indices.map { it.toInt() }))
    fundingAddress = deriveAccountAddressRange(record.entropy, 1u, 1u).single()
    operation = SwapOperation.start(next.toString(), record.entropy, gateway, now())
    persist()
  }

  fun restore() {
    val root = checkNotNull(saved.load())
    fundingAddress = root.getString("fundingAddress")
    operation = SwapOperation.restore(root.getString("state"), gateway)
  }

  /**
   * Drives the operation until it needs the user (review, unlock) or stops (finished, paused).
   * Waits for Aurora and 1inch happen here, so an open screen carries the swap to the end.
   */
  suspend fun advance(onProgress: (Map<String, Any?>) -> Unit = {}): SwapUi {
    val op = checkNotNull(operation)
    while (true) {
      when (val step = op.nextStep(now())) {
        is SwapStep.Review -> {
          persist()
          return SwapUi.Review(step.text)
        }
        is SwapStep.Unlock -> {
          persist()
          return SwapUi.Unlock
        }
        is SwapStep.Finished,
        is SwapStep.Paused -> {
          persist()
          return SwapUi.Done(view())
        }
        is SwapStep.Wait -> {
          persist()
          onProgress(view())
          kotlinx.coroutines.delay(step.millis.toLong())
        }
        is SwapStep.Request -> {
          check(NativeRpcTransport.allowed(step.url))
          persist()
          diagnostic("request_start", step.id)
          val started = android.os.SystemClock.elapsedRealtime()
          val (status, body) =
            try {
              transport.execute(step.method, step.url, step.body)
            } catch (_: RpcFailure) {
              0 to ""
            }
          diagnostic(
            "request_end",
            step.id,
            status,
            android.os.SystemClock.elapsedRealtime() - started,
          )
          try {
            op.onResponse(step.id, status.toUShort(), body, now())
          } catch (error: CancellationException) {
            throw error
          } catch (error: Exception) {
            if (JSONObject(op.publicStatus()).isNull("pausedCode")) throw error
          }
          persist()
          onProgress(view())
        }
      }
    }
  }

  fun approve() {
    checkNotNull(operation).approve(now())
    persist()
  }

  fun unlock(record: WalletRecord) {
    check(record.id == saved.walletId)
    checkNotNull(operation).unlock(record.entropy, now())
    persist()
  }

  fun retry() {
    operation?.retry()
  }

  fun cancel() {
    operation?.cancel()
    persist()
  }

  fun view(): Map<String, Any?> {
    val status = JSONObject(checkNotNull(operation).publicStatus())
    fun text(name: String) = if (status.isNull(name)) null else status.optString(name)
    return mapOf(
      "operationId" to status.getString("operationId"),
      "phase" to status.getString("phase"),
      "step" to status.getString("step"),
      "pausedCode" to text("pausedCode"),
      "targetSymbol" to status.optString("targetSymbol"),
      "targetDecimals" to status.optInt("targetDecimals"),
      "sourceAtoms" to status.optString("sourceAtoms"),
      "creditedAtoms" to status.optString("creditedAtoms"),
      "payoutsSubmitted" to status.optInt("payoutsSubmitted"),
      "ordersComplete" to status.optInt("ordersComplete"),
      "receivedTargetAtoms" to status.optString("receivedTargetAtoms"),
      "direction" to status.optString("direction", "buy"),
      "approved" to status.optBoolean("approved"),
      "returnAddresses" to returnAddresses(),
      "fundingAddress" to checkNotNull(fundingAddress),
    )
  }

  private fun returnAddresses(): List<String> {
    val root = saved.load() ?: return emptyList()
    val state = JSONObject(root.getString("state"))
    if (state.optJSONObject("plan")?.optString("kind") != "confidentialSell") return emptyList()
    val recipients = state.optJSONArray("recipients") ?: return emptyList()
    return (0 until recipients.length()).map { recipients.getString(it) }
  }

  private fun persist() {
    val op = checkNotNull(operation)
    saved.portfolio.remember(op.exportState(), op.publicStatus())
    saved.save(op.operationId(), op.exportState(), checkNotNull(fundingAddress))
    diagnostic("persisted")
  }

  // Enable explicitly with: adb shell setprop log.tag.GizuSwap DEBUG.
  // Never log the exported state, URLs, bodies, addresses or signatures.
  private fun diagnostic(
    event: String,
    requestId: ULong? = null,
    status: Int? = null,
    elapsedMs: Long? = null,
  ) {
    if (!Log.isLoggable("GizuSwap", Log.DEBUG)) return
    val state = operation?.let { JSONObject(it.publicStatus()) } ?: return
    fun label(key: String): String =
      state.optString(key).takeIf { it.matches(Regex("[A-Za-z0-9_]{1,64}")) } ?: "none"
    Log.d(
      "GizuSwap",
      "$event phase=${label("phase")} step=${label("step")} pause=${label("pausedCode")} request=$requestId status=$status elapsedMs=$elapsedMs",
    )
  }

  override fun close() {
    operation?.close()
    operation = null
  }

  private fun now() = System.currentTimeMillis().toULong()
}
