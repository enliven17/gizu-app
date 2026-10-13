package io.gizu.storedwallet.swap

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.gizu.storedwallet.NativeStyle
import io.gizu.storedwallet.PasskeyGate
import io.gizu.storedwallet.walletStore
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellableContinuation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout

internal object SwapHost {
  var token: String? = null
    private set

  var screen: SwapActivity? = null
  private var completion: CancellableContinuation<Map<String, Any?>>? = null
  private var closing: Job? = null
  var target: String? = null
  var amountAtoms: String? = null
  var gateway: String? = null
  var resume: Boolean = false
  var sell: Boolean = false
  var payout: Boolean = false
  var recovery: Boolean = false
  var holdingId: String? = null
  var sweepTo: String? = null

  suspend fun open(
    activity: Activity,
    gateway: String,
    target: String?,
    amountAtoms: String?,
    resume: Boolean,
    sell: Boolean = false,
    payout: Boolean = false,
    recovery: Boolean = false,
    holdingId: String? = null,
    sweepTo: String? = null,
  ): Map<String, Any?> {
    try {
      return suspendCancellableCoroutine { continuation ->
        check(completion == null)
        token = UUID.randomUUID().toString()
        this.gateway = gateway
        this.target = target
        this.amountAtoms = amountAtoms
        this.resume = resume
        this.sell = sell
        this.payout = payout
        this.recovery = recovery
        this.holdingId = holdingId
        this.sweepTo = sweepTo
        completion = continuation
        continuation.invokeOnCancellation { activity.runOnUiThread { close(null) } }
        try {
          activity.startActivity(
            Intent(activity, SwapActivity::class.java).putExtra("token", token)
          )
        } catch (_: Exception) {
          close(null)
        }
      }
    } finally {
      withContext(NonCancellable) { closing?.join() }
      closing = null
    }
  }

  fun fail(message: String) {
    val result = completion
    completion = null
    token = null
    val current = screen
    screen = null
    fun done() {
      if (result?.isActive == true) result.resumeWithException(IllegalStateException(message))
    }
    if (current == null) done()
    else {
      current.stopWork()
      current.finish()
      closing =
        CoroutineScope(Dispatchers.Main.immediate).launch {
          current.awaitWork()
          done()
        }
    }
  }

  fun close(view: Map<String, Any?>?) {
    val result = completion
    completion = null
    token = null
    val current = screen
    screen = null
    fun done() {
      if (result?.isActive == true) {
        if (view != null) result.resume(view) else result.cancel()
      }
    }
    if (current == null) done()
    else {
      current.stopWork()
      current.finish()
      closing =
        CoroutineScope(Dispatchers.Main.immediate).launch {
          current.awaitWork()
          done()
        }
    }
  }
}

/** Native review for the whole confidential swap. Signed bytes stay in the encrypted swap file. */
class SwapActivity : Activity() {
  private val job = SupervisorJob()
  private val scope = CoroutineScope(job + Dispatchers.Main.immediate)
  private lateinit var root: LinearLayout
  private var engine: SwapEngine? = null
  private var providerPending = false
  private var stopped = false
  /** Set while this screen only watches a swap that [SwapBackground] drives. */
  private var unlisten: (() -> Unit)? = null

  internal fun stopWork() {
    stopped = true
    unlisten?.invoke()
    unlisten = null
    engine?.close()
    job.cancel()
  }

  internal suspend fun awaitWork() {
    job.join()
  }

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (
      state != null || SwapHost.token == null || intent.getStringExtra("token") != SwapHost.token
    ) {
      finish()
      return
    }
    SwapHost.screen = this
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    // A buy runs for several minutes; a locked screen would pause it half way.
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    if (Build.VERSION.SDK_INT >= 31) window.setHideOverlayWindows(true)
    root =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setBackgroundColor(NativeStyle.ink)
        setPadding(
          NativeStyle.dp(this@SwapActivity, 24),
          NativeStyle.dp(this@SwapActivity, 24),
          NativeStyle.dp(this@SwapActivity, 24),
          NativeStyle.dp(this@SwapActivity, 24),
        )
      }
    setContentView(root)
    show(
      "Preparing the swap",
      "Checking the funding wallet, quotes and limits. Nothing is signed yet.",
    )
    if (SwapBackground.running) {
      // An approved swap is already running in the background: watch it instead of starting.
      watch()
      return
    }
    scope.launch {
      try {
        val gateway = checkNotNull(SwapHost.gateway)
        check(NativeRpcTransportAllowed(gateway))
        val wallet = walletStore(applicationContext)
        val record = withContext(Dispatchers.IO) { wallet.load() }
        try {
          check(record.verified)
          val saved = SwapStore(applicationContext, record)
          val active = SwapEngine(wallet, saved, gateway)
          engine = active
          if (SwapHost.resume) {
            active.restore()
            active.retry()
          } else if (SwapHost.sell) {
            active.startSell(record, SwapHost.holdingId, SwapHost.sweepTo)
          } else if (SwapHost.recovery) {
            active.startRecovery(record, checkNotNull(SwapHost.target))
          } else if (SwapHost.payout) {
            active.start(record, checkNotNull(SwapHost.target), null, "confidentialPayout")
          } else active.start(record, checkNotNull(SwapHost.target), SwapHost.amountAtoms)
        } finally {
          record.close()
        }
        present(checkNotNull(engine).advance(::progress))
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.e("SwapActivity", "swap failed", error)
        SwapHost.fail(error.message ?: error.javaClass.simpleName)
      }
    }
  }

  private fun present(ui: SwapUi) {
    if (stopped) return
    when (ui) {
      is SwapUi.Review -> showReview(ui.text)
      is SwapUi.Unlock -> unlock()
      is SwapUi.Done -> SwapHost.close(ui.view)
    }
  }

  private fun approved() =
    runCatching {
        (engine?.view() ?: SwapBackground.lastView.takeIf { unlisten != null })?.get("approved") ==
          true
      }
      .getOrDefault(false)

  /** The current public status, from this screen's engine or from the background run. */
  private fun currentView() =
    runCatching { engine?.view() }.getOrNull()
      ?: SwapBackground.lastView.takeIf { unlisten != null }

  /**
   * After approval the swap no longer needs this screen: hand the engine (and its in-memory
   * authority) to [SwapBackground] and keep watching while the screen stays open.
   */
  private fun handOff() {
    val active = checkNotNull(engine)
    engine = null
    askForNotifications()
    SwapBackground.run(applicationContext, active)
    watch()
  }

  private fun watch() {
    unlisten?.invoke()
    unlisten =
      SwapBackground.listen { event ->
        runOnUiThread {
          if (stopped) return@runOnUiThread
          when (event) {
            is SwapBackground.Event.Progress -> progress(event.view)
            is SwapBackground.Event.NeedsUser -> {
              unlisten?.invoke()
              unlisten = null
              engine = SwapBackground.takeBack()
              present(event.ui)
            }
            is SwapBackground.Event.Finished -> {
              unlisten?.invoke()
              unlisten = null
              SwapHost.close(event.view)
            }
          }
        }
      }
    SwapBackground.lastView?.let { progress(it) }
  }

  /** Progress and results are notifications; ask once, never block the swap on the answer. */
  private fun askForNotifications() {
    if (
      Build.VERSION.SDK_INT >= 33 &&
        checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) !=
          android.content.pm.PackageManager.PERMISSION_GRANTED
    ) {
      providerPending = true
      requestPermissions(arrayOf(android.Manifest.permission.POST_NOTIFICATIONS), NOTIFY_REQUEST)
    }
  }

  @Deprecated("Platform permission callback")
  override fun onRequestPermissionsResult(
    requestCode: Int,
    permissions: Array<out String>,
    grantResults: IntArray,
  ) {
    @Suppress("DEPRECATION") super.onRequestPermissionsResult(requestCode, permissions, grantResults)
    if (requestCode == NOTIFY_REQUEST) providerPending = false
  }

  private fun progress(view: Map<String, Any?>) {
    if (stopped) return
    root.removeAllViews()
    root.addView(
      SwapScreens.progress(this, view, view["approved"] == true),
      LinearLayout.LayoutParams(-1, 0, 1f),
    )
    root.addView(
      NativeStyle.button(
          this,
          when {
            unlisten != null -> "Continue in background"
            approved() -> "Pause and go back"
            else -> "Cancel swap"
          },
          false,
        )
        .apply { setOnClickListener { cancelOrLeave() } },
      NativeStyle.fullWidth(this, 16),
    )
  }

  /**
   * After approval funds may be in flight, so leaving pauses the operation instead of cancelling
   * it.
   */
  private fun leave() {
    SwapHost.close(currentView())
  }

  private fun cancelOrLeave() {
    if (approved()) leave() else cancel()
  }

  private fun show(title: String, message: String) {
    root.removeAllViews()
    root.addView(
      SwapScreens.preparing(this, title, message),
      LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = NativeStyle.dp(this@SwapActivity, 64) },
    )
  }

  private fun showReview(text: String, error: String? = null) {
    root.removeAllViews()
    root.addView(NativeStyle.title(this, "Review swap", 22f))
    if (error != null)
      root.addView(
        NativeStyle.body(this, error, NativeStyle.danger).apply {
          background = NativeStyle.rounded(this@SwapActivity, 0x16FF9B9B, 16, NativeStyle.dangerBorder)
          setPadding(
            NativeStyle.dp(this@SwapActivity, 14),
            NativeStyle.dp(this@SwapActivity, 12),
            NativeStyle.dp(this@SwapActivity, 14),
            NativeStyle.dp(this@SwapActivity, 12),
          )
        },
        NativeStyle.fullWidth(this, 12),
      )
    val scroll = ScrollView(this).apply { isVerticalScrollBarEnabled = false }
    scroll.addView(SwapScreens.review(this, text))
    root.addView(
      scroll,
      LinearLayout.LayoutParams(-1, 0, 1f).apply {
        topMargin = NativeStyle.dp(this@SwapActivity, 16)
      },
    )
    // Approval stays locked until the whole review has been scrolled through; say so.
    val hint =
      NativeStyle.body(this, "Scroll to the end to approve", NativeStyle.disabledText).apply {
        textSize = 12f
        gravity = android.view.Gravity.CENTER
      }
    root.addView(hint, NativeStyle.fullWidth(this, 10))
    val approve =
      NativeStyle.button(
        this,
        if (engine?.hasFundingBatch == true) "Approve funding batch" else "Approve for 15 minutes",
        true,
      )
    approve.isEnabled = false
    approve.setOnClickListener {
      if (!approve.isEnabled || stopped) return@setOnClickListener
      approve.isEnabled = false
      authorize(text)
    }
    root.addView(approve, NativeStyle.fullWidth(this, 8))
    root.addView(
      NativeStyle.button(this, if (approved()) "Not now" else "Cancel", false).apply {
        setOnClickListener { cancelOrLeave() }
      },
      NativeStyle.fullWidth(this, 10),
    )
    fun sync() {
      val ready = !scroll.canScrollVertically(1) && !stopped
      approve.isEnabled = ready
      hint.visibility = if (ready) View.GONE else View.VISIBLE
    }
    scroll.viewTreeObserver.addOnScrollChangedListener { sync() }
    scroll.post { sync() }
  }

  private fun authorize(text: String) {
    scope.launch {
      try {
        val wallet = walletStore(applicationContext)
        val identity = withContext(Dispatchers.IO) { wallet.load().use { it.id to it.credential } }
        val digest = checkNotNull(engine).reviewDigest(text)
        providerPending = true
        try {
          PasskeyGate(this@SwapActivity)
            .authorize(
              identity.second,
              identity.first,
              "swap:v1:${engine?.view()?.get("operationId")}:$digest",
            )
          withTimeout(FOCUS_TIMEOUT_MS) { while (!hasWindowFocus()) delay(FOCUS_POLL_INTERVAL_MS) }
        } finally {
          providerPending = false
        }
        check(!stopped && hasWindowFocus())
        check(!(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked)
        // Restored operations contain no signing key. Rehydrate it only after
        // the passkey assertion, then approve the exact review shown above.
        val record = withContext(Dispatchers.IO) { wallet.load() }
        try {
          check(!stopped && hasWindowFocus())
          check(!(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked)
          check(record.id == identity.first)
          checkNotNull(engine).authorizeReviewed(record, text)
        } finally {
          record.close()
        }
        show(
          "Submitting the approved steps",
          "You can leave this screen; the swap continues in the background.",
        )
        handOff()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.e("SwapActivity", "approval failed", error)
        if (!stopped) {
          if (engine?.hasFundingBatch == true) {
            try {
              val refreshed = checkNotNull(engine).advance(::progress)
              if (refreshed is SwapUi.Review)
                showReview(refreshed.text, error.message ?: error.javaClass.simpleName)
              else present(refreshed)
            } catch (refreshError: CancellationException) {
              throw refreshError
            } catch (refreshError: Exception) {
              SwapHost.fail(refreshError.message ?: refreshError.javaClass.simpleName)
            }
          } else showReview(text, error.message ?: error.javaClass.simpleName)
        }
      }
    }
  }

  private fun unlock() {
    root.removeAllViews()
    root.addView(SwapScreens.unlock(this), LinearLayout.LayoutParams(-1, 0, 1f))
    root.addView(
      NativeStyle.button(this, "Unlock", true).apply { setOnClickListener { unlockPasskey() } },
      NativeStyle.fullWidth(this, 16),
    )
    root.addView(
      NativeStyle.button(this, if (approved()) "Not now" else "Cancel", false).apply {
        setOnClickListener { cancelOrLeave() }
      },
      NativeStyle.fullWidth(this, 10),
    )
  }

  private fun unlockPasskey() {
    scope.launch {
      try {
        val wallet = walletStore(applicationContext)
        val identity = withContext(Dispatchers.IO) { wallet.load().use { it.id to it.credential } }
        providerPending = true
        try {
          PasskeyGate(this@SwapActivity)
            .authorize(
              identity.second,
              identity.first,
              "swap-unlock:v1:${engine?.view()?.get("operationId")}",
            )
          withTimeout(FOCUS_TIMEOUT_MS) { while (!hasWindowFocus()) delay(FOCUS_POLL_INTERVAL_MS) }
        } finally {
          providerPending = false
        }
        val record = withContext(Dispatchers.IO) { wallet.load() }
        try {
          engine?.unlock(record)
        } finally {
          record.close()
        }
        handOff()
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.e("SwapActivity", "unlock failed", error)
        if (!stopped) unlock()
      }
    }
  }

  private fun cancel() {
    // A swap that failed while preparing has no operation yet; leaving must not crash on it.
    try {
      runCatching { engine?.cancel() }
    } finally {
      SwapHost.close(currentView())
    }
  }

  override fun onPause() {
    super.onPause()
    // Leaving never stops a background run; it only returns the current status to the app.
    if (!providerPending && !isFinishing) SwapHost.close(currentView())
  }

  @Deprecated("Platform back")
  override fun onBackPressed() {
    cancelOrLeave()
  }

  override fun onDestroy() {
    stopWork()
    if (SwapHost.screen === this) SwapHost.close(null)
    super.onDestroy()
  }
}

private const val NOTIFY_REQUEST = 4403
private const val FOCUS_TIMEOUT_MS = 10_000L
private const val FOCUS_POLL_INTERVAL_MS = 50L

private fun NativeRpcTransportAllowed(url: String) =
  io.gizu.storedwallet.NativeRpcTransport.allowed(url)
