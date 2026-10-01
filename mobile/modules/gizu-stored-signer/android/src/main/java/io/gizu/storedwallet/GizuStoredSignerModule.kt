package io.gizu.storedwallet

import android.app.Activity
import android.app.Dialog
import android.app.KeyguardManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.Window
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import io.gizu.storedwallet.swap.SwapEngine
import io.gizu.storedwallet.swap.SwapHost
import io.gizu.storedwallet.swap.SwapStore
import java.security.SecureRandom
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import uniffi.gizu_stored_signer_core.deriveAccountAddressRange
import uniffi.gizu_stored_signer_core.deriveAccountAddresses

/** Wallet access requires a verified native backup; exact transfer signing stays native. */
class GizuStoredSignerModule : Module() {
  companion object {
    private val ceremony = Mutex()
    private const val CEREMONY_TIMEOUT_MS = 120000L
    private const val FOCUS_TIMEOUT_MS = 10000L
    private const val FOCUS_POLL_INTERVAL_MS = 50L
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var task: Job? = null
  private var dialog: Dialog? = null
  private var awaitingProvider = false
  private var foreground = true

  private fun eligible(activity: Activity?) =
    activity != null &&
      Build.VERSION.SDK_INT >= 28 &&
      (activity.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0

  private fun requireForeground(activity: Activity) {
    check(foreground && !activity.isFinishing && !activity.isDestroyed && activity.hasWindowFocus())
    check(
      !(activity.getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked
    )
  }

  private suspend fun confirm(activity: Activity, create: Boolean) =
    suspendCancellableCoroutine<Unit> { continuation ->
      val alert = Dialog(activity)
      alert.requestWindowFeature(Window.FEATURE_NO_TITLE)
      // Same dismissal semantics as the former AlertDialog: back and outside touch cancel.
      alert.setCancelable(true)
      alert.setCanceledOnTouchOutside(true)
      alert.setOnCancelListener { continuation.cancel() }
      alert.setContentView(
        confirmationView(
          activity,
          title = if (create) "Create Gizu wallet" else "Open Gizu wallet",
          message =
            if (create)
              "Create a passkey and a new wallet stored encrypted on this phone. A verified backup is required before this wallet can be used."
            else "Confirm your passkey to check this wallet. This does not authorize transfers.",
          onContinue = {
            if (continuation.isActive) continuation.resume(Unit)
            alert.dismiss()
          },
          onCancel = {
            continuation.cancel()
            alert.dismiss()
          },
        )
      )
      dialog = alert
      alert.window?.apply {
        addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        if (Build.VERSION.SDK_INT >= 31) setHideOverlayWindows(true)
        setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.WRAP_CONTENT)
        setGravity(Gravity.CENTER)
        setDimAmount(0.72f)
      }
      alert.show()
      continuation.invokeOnCancellation { scope.launch { alert.dismiss() } }
    }

  private fun confirmationView(
    activity: Activity,
    title: String,
    message: String,
    onContinue: () -> Unit,
    onCancel: () -> Unit,
  ): View {
    fun dp(value: Int) = NativeStyle.dp(activity, value)
    val card =
      LinearLayout(activity).apply {
        orientation = LinearLayout.VERTICAL
        background = NativeStyle.rounded(activity, NativeStyle.surface, 24, NativeStyle.glassBorder)
        setPadding(dp(24), dp(24), dp(24), dp(20))
        filterTouchesWhenObscured = true
        addView(NativeStyle.title(activity, title, 22f))
        addView(NativeStyle.body(activity, message), NativeStyle.fullWidth(activity, 10))
        addView(
          NativeStyle.button(activity, "Continue", primary = true).apply {
            setOnClickListener { onContinue() }
          },
          NativeStyle.fullWidth(activity, 24),
        )
        addView(
          NativeStyle.button(activity, "Cancel", primary = false).apply {
            setOnClickListener { onCancel() }
          },
          NativeStyle.fullWidth(activity, 10),
        )
      }
    return FrameLayout(activity).apply {
      setPadding(dp(20), dp(20), dp(20), dp(20))
      addView(card)
    }
  }

  private fun runCeremony(
    promise: Promise,
    wait: Boolean = false,
    timeoutMs: Long = CEREMONY_TIMEOUT_MS,
    block: suspend (Activity, WalletStore) -> Any,
  ) {
    scope.launch {
      val activity = appContext.currentActivity
      if (!eligible(activity)) {
        promise.reject("UNAVAILABLE", "Android development wallet unavailable.", null)
        return@launch
      }
      if (wait) ceremony.lock()
      if (!wait && !ceremony.tryLock()) {
        promise.reject("BUSY", "A native wallet operation is already in progress.", null)
        return@launch
      }
      task = coroutineContext[Job]
      try {
        requireForeground(activity!!)
        val result =
          withTimeout(timeoutMs) { block(activity, walletStore(activity.applicationContext)) }
        currentCoroutineContext().ensureActive()
        requireForeground(activity)
        promise.resolve(result)
      } catch (error: Exception) {
        WalletDiagnostics.failed(WalletStage.CEREMONY, error)
        val code = WalletErrors.code(error)
        promise.reject(code.name, code.message, null)
      } finally {
        dialog?.dismiss()
        dialog = null
        awaitingProvider = false
        task = null
        ceremony.unlock()
      }
    }
  }

  private suspend fun <T> withProviderUi(activity: Activity, action: suspend () -> T): T {
    withTimeout(FOCUS_TIMEOUT_MS) {
      while (foreground && !activity.hasWindowFocus()) delay(FOCUS_POLL_INTERVAL_MS)
    }
    requireForeground(activity)
    awaitingProvider = true
    try {
      val result = action()
      // System credential UI may temporarily take focus. A locked/background app cannot
      // consume results.
      withTimeout(FOCUS_TIMEOUT_MS) {
        while (!foreground || !activity.hasWindowFocus()) {
          delay(FOCUS_POLL_INTERVAL_MS)
        }
      }
      requireForeground(activity)
      return result
    } finally {
      awaitingProvider = false
    }
  }

  override fun definition() = ModuleDefinition {
    Name("GizuStoredSigner")
    AsyncFunction("getCapabilities") { promise: Promise ->
      promise.resolve(
        mapOf(
          "contractVersion" to 1,
          "available" to eligible(appContext.currentActivity),
          "walletStorage" to eligible(appContext.currentActivity),
          "backup" to eligible(appContext.currentActivity),
          "transfers" to eligible(appContext.currentActivity),
          "swaps" to eligible(appContext.currentActivity),
        )
      )
    }
    AsyncFunction("getWalletState") { promise: Promise ->
      runCeremony(promise) { _, store -> withContext(Dispatchers.IO) { publicState(store) } }
    }
    AsyncFunction("createWallet") { promise: Promise ->
      runCeremony(promise) { activity, store -> createWallet(activity, store) }
    }
    AsyncFunction("openWallet") { promise: Promise ->
      runCeremony(promise) { activity, store ->
        val state = withContext(Dispatchers.IO) { store.state() }
        if (state["status"] == "absent" || state["status"] == "recoveryRequired") state
        else {
          val identity = withContext(Dispatchers.IO) { store.load().use { it.id to it.credential } }
          confirm(activity, false)
          withProviderUi(activity) {
            PasskeyGate(activity).authorize(identity.second, identity.first)
          }
          currentCoroutineContext().ensureActive()
          withContext(Dispatchers.IO) {
            store.load().use {
              check(it.id == identity.first)
              project(it)
            }
          }
        }
      }
    }
    AsyncFunction("backupWallet") { promise: Promise ->
      runCeremony(promise) { activity, store ->
        check(
          withContext(Dispatchers.IO) {
            store.state()["status"] in listOf("backupRequired", "ready")
          }
        )
        withProviderUi(activity) { BackupHost.open(activity, false) }
        withContext(Dispatchers.IO) { publicState(store) }
      }
    }
    AsyncFunction("restoreWallet") { promise: Promise ->
      runCeremony(promise) { activity, store ->
        check(
          withContext(Dispatchers.IO) {
            store.state()["status"] in listOf("absent", "recoveryRequired")
          }
        )
        withProviderUi(activity) { BackupHost.open(activity, true) }
        withContext(Dispatchers.IO) { publicState(store) }
      }
    }
    AsyncFunction("executeOperation") { proposal: Map<String, Any?>, promise: Promise ->
      runCeremony(promise) { activity, store ->
        val journal = store.load().use { operationJournal(activity, it) }
        reconcileOperations(journal, MonadRpc())
        val operation = store.load().use { createOperation(journal, it, proposal) }
        withProviderUi(activity) {
          TransferHost.open(
            activity,
            operation.getString("operationId"),
            operation.getInt("revision"),
          )
        }
        journal.public(journal.get(operation.getString("operationId")))
      }
    }
    AsyncFunction("listOperations") { promise: Promise ->
      runCeremony(promise) { activity, store ->
        val journal = store.load().use { operationJournal(activity, it) }
        reconcileOperations(journal, MonadRpc())
        journal.all().map { journal.public(it) }
      }
    }
    AsyncFunction("getOperationStatus") { id: String, promise: Promise ->
      runCeremony(promise) { activity, store ->
        val journal = store.load().use { operationJournal(activity, it) }
        reconcileOperations(journal, MonadRpc())
        journal.public(journal.get(id))
      }
    }
    AsyncFunction("resumeOperation") { id: String, revision: Int, promise: Promise ->
      runCeremony(promise) { activity, store ->
        val journal = store.load().use { operationJournal(activity, it) }
        check(journal.get(id).getInt("revision") == revision)
        withProviderUi(activity) { TransferHost.open(activity, id, revision) }
        journal.public(journal.get(id))
      }
    }
    AsyncFunction("cancelOperation") { id: String, promise: Promise ->
      scope.launch {
        if (TransferHost.id == id) task?.cancel()
        runCeremony(promise, wait = true) { activity, store ->
          val journal = store.load().use { operationJournal(activity, it) }
          journal.public(journal.cancel(id))
        }
      }
    }
    AsyncFunction("getSwapDeposit") { promise: Promise ->
      runCeremony(promise) { _, store ->
        withContext(Dispatchers.IO) {
          store.load().use { record ->
            check(record.verified)
            mapOf("fundingAddress" to deriveAccountAddressRange(record.entropy, 1u, 1u).single())
          }
        }
      }
    }
    AsyncFunction("startSwap") {
      target: String,
      amountAtoms: String,
      gateway: String,
      promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) {
          SwapHost.open(activity, gateway, target, amountAtoms.ifBlank { null }, false)
        }
      }
    }
    AsyncFunction("startPayout") { target: String, gateway: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) {
          SwapHost.open(activity, gateway, target, null, false, payout = true)
        }
      }
    }
    AsyncFunction("startRecovery") { target: String, gateway: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) {
          SwapHost.open(activity, gateway, target, null, false, recovery = true)
        }
      }
    }
    AsyncFunction("getMainnetPortfolio") { promise: Promise ->
      runCeremony(promise, timeoutMs = 180_000L) { activity, store ->
        withContext(Dispatchers.IO) {
          store.load().use { record ->
            check(record.verified)
            val saved = SwapStore(activity.applicationContext, record)
            saved.load()?.let { root ->
              val op =
                uniffi.gizu_stored_signer_core.SwapOperation.restore(
                  root.getString("state"),
                  "https://gizu-backend.onrender.com",
                )
              try {
                saved.portfolio.remember(root.getString("state"), op.publicStatus())
              } finally {
                op.close()
              }
            }
            io.gizu.storedwallet.swap.MainnetPortfolio().read(record, saved.portfolio.history())
          }
        }
      }
    }
    AsyncFunction("getSwapHoldings") { target: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 180_000L) { activity, store ->
        withContext(Dispatchers.IO) {
          store.load().use { record ->
            check(record.verified)
            val saved = SwapStore(activity.applicationContext, record)
            saved.load()?.let { root ->
              val previous =
                uniffi.gizu_stored_signer_core.SwapOperation.restore(
                  root.getString("state"),
                  "https://gizu-backend.onrender.com",
                )
              try {
                saved.portfolio.remember(root.getString("state"), previous.publicStatus())
              } finally {
                previous.close()
              }
            }
            val targets =
              saved.portfolio.targets() +
                listOfNotNull(target.lowercase().takeIf { it.isNotBlank() })
            val snapshot = io.gizu.storedwallet.swap.SwapHoldings().read(record, targets)
            if (target.isNotBlank()) saved.portfolio.watch(target)
            snapshot
          }
        }
      }
    }
    AsyncFunction("sellSwapHolding") { holdingId: String, gateway: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) {
          SwapHost.open(activity, gateway, null, null, false, sell = true, holdingId = holdingId)
        }
      }
    }
    AsyncFunction("startSell") { gateway: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) { SwapHost.open(activity, gateway, null, null, false, true) }
      }
    }
    AsyncFunction("resumeSwap") { gateway: String, promise: Promise ->
      runCeremony(promise, timeoutMs = 900_000L) { activity, _ ->
        withProviderUi(activity) { SwapHost.open(activity, gateway, null, null, true) }
      }
    }
    AsyncFunction("getSwapStatus") { gateway: String, promise: Promise ->
      runCeremony(promise) { activity, store ->
        withContext(Dispatchers.IO) {
          store.load().use { record ->
            SwapEngine(store, SwapStore(activity.applicationContext, record), gateway).use { engine
              ->
              engine.restore()
              engine.view()
            }
          }
        }
      }
    }
    AsyncFunction("cancelSwap") { gateway: String, promise: Promise ->
      scope.launch {
        if (SwapHost.token != null) task?.cancel()
        runCeremony(promise, wait = true) { activity, store ->
          withContext(Dispatchers.IO) {
            store.load().use { record ->
              SwapEngine(store, SwapStore(activity.applicationContext, record), gateway).use {
                engine ->
                engine.restore()
                engine.cancel()
                engine.view()
              }
            }
          }
        }
      }
    }
    Function("lock") { scope.launch { task?.cancel() } }
    OnActivityEntersForeground { foreground = true }
    OnActivityEntersBackground {
      foreground = false
      if (!awaitingProvider) task?.cancel()
    }
    OnDestroy {
      task?.cancel()
      dialog?.dismiss()
      scope.cancel()
    }
  }

  private suspend fun createWallet(activity: Activity, store: WalletStore): Map<String, Any> {
    check(withContext(Dispatchers.IO) { !store.exists() })
    confirm(activity, true)
    val credential = withProviderUi(activity) { PasskeyGate(activity).register() }
    currentCoroutineContext().ensureActive()
    // No entropy is generated or held during the system credential ceremony.
    return withContext(Dispatchers.IO) {
      val entropy = ByteArray(32).also { SecureRandom().nextBytes(it) }
      try {
        WalletRecord(UUID.randomUUID().toString(), credential, entropy).use { record ->
          // Verify the native core is available before persisting; addresses
          // remain hidden until backup.
          check(deriveAccountAddresses(entropy).size == 16)
          currentCoroutineContext().ensureActive()
          store.create(record)
          record.publicState()
        }
      } finally {
        entropy.fill(0)
      }
    }
  }

  private fun publicState(store: WalletStore): Map<String, Any> {
    val state = store.state()
    return if (state["status"] == "ready") store.load().use { project(it) } else state
  }

  private fun project(record: WalletRecord): Map<String, Any> =
    if (!record.verified) record.publicState()
    else
      record.publicState() +
        ("accounts" to
          deriveAccountAddresses(record.entropy).mapIndexed { index, address ->
            mapOf("accountIndex" to index, "address" to address, "chainId" to 10143)
          })
}
