package io.gizu.storedwallet.swap

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import io.gizu.storedwallet.NativeStyle
import io.gizu.storedwallet.PasskeyGate
import io.gizu.storedwallet.walletStore
import java.security.MessageDigest
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CancellableContinuation
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

  suspend fun open(
    activity: Activity,
    gateway: String,
    target: String?,
    amountAtoms: String?,
    resume: Boolean,
    sell: Boolean = false,
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
        completion = continuation
        continuation.invokeOnCancellation { activity.runOnUiThread { close(null) } }
        try {
          activity.startActivity(Intent(activity, SwapActivity::class.java).putExtra("token", token))
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
      closing = CoroutineScope(Dispatchers.Main.immediate).launch {
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
      closing = CoroutineScope(Dispatchers.Main.immediate).launch {
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

  internal fun stopWork() {
    stopped = true
    engine?.close()
    job.cancel()
  }

  internal suspend fun awaitWork() {
    job.join()
  }

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (state != null || SwapHost.token == null || intent.getStringExtra("token") != SwapHost.token) {
      finish()
      return
    }
    SwapHost.screen = this
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    if (Build.VERSION.SDK_INT >= 31) window.setHideOverlayWindows(true)
    root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setBackgroundColor(NativeStyle.ink)
      setPadding(NativeStyle.dp(this@SwapActivity, 24), NativeStyle.dp(this@SwapActivity, 24), NativeStyle.dp(this@SwapActivity, 24), NativeStyle.dp(this@SwapActivity, 24))
    }
    setContentView(root)
    show("Preparing the swap", "Checking the funding wallet, quotes and limits. Nothing is signed yet.")
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
            active.startSell(record)
          } else active.start(record, checkNotNull(SwapHost.target), SwapHost.amountAtoms)
        } finally {
          record.close()
        }
        present(checkNotNull(engine).advance())
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

  private fun show(title: String, message: String) {
    root.removeAllViews()
    root.addView(NativeStyle.title(this, title))
    root.addView(NativeStyle.body(this, message), NativeStyle.fullWidth(this, 12))
  }

  private fun showReview(text: String, error: String? = null) {
    root.removeAllViews()
    root.addView(NativeStyle.title(this, "Review swap", 22f))
    if (error != null) root.addView(NativeStyle.body(this, error), NativeStyle.fullWidth(this, 12))
    val scroll = ScrollView(this)
    scroll.addView(NativeStyle.body(this, text, NativeStyle.primaryText).apply {
      setPadding(NativeStyle.dp(this@SwapActivity, 16), NativeStyle.dp(this@SwapActivity, 16), NativeStyle.dp(this@SwapActivity, 16), NativeStyle.dp(this@SwapActivity, 16))
    })
    root.addView(scroll, LinearLayout.LayoutParams(-1, 0, 1f).apply { topMargin = NativeStyle.dp(this@SwapActivity, 16) })
    val approve = NativeStyle.button(this, "Approve for 15 minutes", true)
    approve.isEnabled = false
    approve.setOnClickListener {
      if (!approve.isEnabled || stopped) return@setOnClickListener
      approve.isEnabled = false
      authorize(text)
    }
    root.addView(approve, NativeStyle.fullWidth(this, 16))
    root.addView(NativeStyle.button(this, "Cancel", false).apply { setOnClickListener { cancel() } }, NativeStyle.fullWidth(this, 10))
    scroll.viewTreeObserver.addOnScrollChangedListener { approve.isEnabled = !scroll.canScrollVertically(1) && !stopped }
    scroll.post { approve.isEnabled = !scroll.canScrollVertically(1) && !stopped }
  }

  private fun authorize(text: String) {
    scope.launch {
      try {
        val wallet = walletStore(applicationContext)
        val identity = withContext(Dispatchers.IO) { wallet.load().use { it.id to it.credential } }
        val digest = MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
        providerPending = true
        try {
          PasskeyGate(this@SwapActivity).authorize(identity.second, identity.first, "swap:v1:${engine?.view()?.get("operationId")}:$digest")
          withTimeout(FOCUS_TIMEOUT_MS) { while (!hasWindowFocus()) delay(FOCUS_POLL_INTERVAL_MS) }
        } finally {
          providerPending = false
        }
        check(!stopped && hasWindowFocus())
        check(!(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked)
        engine?.approve()
        show("Swap in progress", "Submitting the approved steps. You can leave and resume; submitted steps are not signed again.")
        present(checkNotNull(engine).advance())
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.e("SwapActivity", "approval failed", error)
        if (!stopped) showReview(text, error.message ?: error.javaClass.simpleName)
      }
    }
  }

  private fun unlock() {
    show("New unlock required", "The 15-minute authorization ended. Unlock the same plan to continue. Nothing new is approved.")
    root.addView(NativeStyle.button(this, "Unlock", true).apply { setOnClickListener { unlockPasskey() } }, NativeStyle.fullWidth(this, 16))
    root.addView(NativeStyle.button(this, "Cancel", false).apply { setOnClickListener { cancel() } }, NativeStyle.fullWidth(this, 10))
  }

  private fun unlockPasskey() {
    scope.launch {
      try {
        val wallet = walletStore(applicationContext)
        val identity = withContext(Dispatchers.IO) { wallet.load().use { it.id to it.credential } }
        providerPending = true
        try {
          PasskeyGate(this@SwapActivity).authorize(identity.second, identity.first, "swap-unlock:v1:${engine?.view()?.get("operationId")}")
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
        present(checkNotNull(engine).advance())
      } catch (error: CancellationException) {
        throw error
      } catch (error: Exception) {
        android.util.Log.e("SwapActivity", "unlock failed", error)
        if (!stopped) unlock()
      }
    }
  }

  private fun cancel() {
    try {
      engine?.cancel()
    } finally {
      SwapHost.close(engine?.view())
    }
  }

  override fun onPause() {
    super.onPause()
    if (!providerPending && !isFinishing) SwapHost.close(runCatching { engine?.view() }.getOrNull())
  }

  @Deprecated("Platform back")
  override fun onBackPressed() {
    cancel()
  }

  override fun onDestroy() {
    stopWork()
    if (SwapHost.screen === this) SwapHost.close(null)
    super.onDestroy()
  }
}

private const val FOCUS_TIMEOUT_MS = 10_000L
private const val FOCUS_POLL_INTERVAL_MS = 50L

private fun NativeRpcTransportAllowed(url: String) =
  io.gizu.storedwallet.NativeRpcTransport.allowed(url)
