package io.gizu.storedwallet

import android.app.Activity
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import java.security.MessageDigest
import java.util.UUID
import kotlin.coroutines.resume
import kotlinx.coroutines.*
import uniffi.gizu_stored_signer_core.deriveAccountAddresses

/** Native-only handoff. No file URI, encrypted file, PRF or entropy crosses Expo. */
internal object BackupHost {
  var token: String? = null
    private set

  private var completion: CancellableContinuation<Unit>? = null
  var screen: BackupActivity? = null
  private var closing: Job? = null

  suspend fun open(activity: Activity, restore: Boolean) {
    try {
      suspendCancellableCoroutine<Unit> { result ->
        check(completion == null)
        val id = UUID.randomUUID().toString()
        token = id
        completion = result
        result.invokeOnCancellation { activity.runOnUiThread { close(false) } }
        try {
          activity.startActivity(
            Intent(activity, BackupActivity::class.java)
              .putExtra("token", id)
              .putExtra("restore", restore)
          )
        } catch (_: Exception) {
          close(false)
        }
      }
    } finally {
      withContext(NonCancellable) { closing?.join() }
      closing = null
    }
  }

  fun close(success: Boolean) {
    val result = completion
    completion = null
    token = null
    val current = screen
    screen = null
    fun complete() {
      if (result?.isActive == true) {
        if (success) result.resume(Unit) else result.cancel()
      }
    }
    if (current != null) {
      current.cancelWork()
      current.finish()
      closing =
        CoroutineScope(Dispatchers.Main.immediate).launch {
          current.awaitWork()
          complete()
        }
    } else complete()
  }
}

class BackupActivity : Activity() {
  private companion object {
    const val SAVE_BACKUP_REQUEST = 1
    const val OPEN_BACKUP_REQUEST = 2
    const val MAX_BACKUP_BYTES = 65536
    const val FOCUS_TIMEOUT_MS = 10000L
    const val FOCUS_POLL_INTERVAL_MS = 50L
  }

  private val workJob = SupervisorJob()
  private val scope = CoroutineScope(workJob + Dispatchers.Main.immediate)

  internal fun cancelWork() {
    workJob.cancel()
  }

  internal suspend fun awaitWork() {
    workJob.join()
  }

  private var observingLock = false
  private val lockReceiver =
    object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == Intent.ACTION_SCREEN_OFF) BackupHost.close(false)
      }
    }
  private var external = false
  private var encrypted: ByteArray? = null
  private var saved = false
  private var busy = false
  private var restore = false
  private lateinit var message: TextView
  private lateinit var action: Button
  private val store by lazy { walletStore(applicationContext) }

  override fun onCreate(state: Bundle?) {
    super.onCreate(state)
    if (
      state != null ||
        intent.getStringExtra("token") != BackupHost.token ||
        BackupHost.token == null
    ) {
      finish()
      return
    }
    BackupHost.screen = this
    val filter = IntentFilter(Intent.ACTION_SCREEN_OFF)
    if (Build.VERSION.SDK_INT >= 33)
      registerReceiver(lockReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    else {
      @Suppress("DEPRECATION") registerReceiver(lockReceiver, filter)
    }
    observingLock = true
    restore = intent.getBooleanExtra("restore", false)
    window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
    if (Build.VERSION.SDK_INT >= 31) window.setHideOverlayWindows(true)
    val layout =
      LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(32, 64, 32, 32)
        setBackgroundColor(0xff080d09.toInt())
      }
    message =
      TextView(this).apply {
        textSize = 20f
        setTextColor(0xffe0e8e2.toInt())
      }
    message.text =
      if (restore)
        "Restore Gizu wallet\n\nChoose your encrypted backup. You need the original passkey. Recovery restores wallet accounts, not transaction history."
      else
        "Back up your Gizu wallet\n\nSave the encrypted file, then reopen it to verify recovery. You need BOTH this file and your original passkey to recover your wallet. Keep them available independently of this phone. You will confirm your passkey twice."
    action =
      Button(this).apply {
        text = if (restore) "Choose backup" else "Save encrypted backup"
        filterTouchesWhenObscured = true
        setOnClickListener {
          if (!busy) {
            if (restore || saved) choose() else save()
          }
        }
      }
    layout.addView(message)
    layout.addView(action)
    layout.addView(
      Button(this).apply {
        text = "Cancel"
        filterTouchesWhenObscured = true
        setOnClickListener { BackupHost.close(false) }
      }
    )
    val scroll =
      ScrollView(this).apply {
        addView(layout)
        setBackgroundColor(0xff080d09.toInt())
      }
    val padding = (24 * resources.displayMetrics.density).toInt()
    scroll.setOnApplyWindowInsetsListener { _, insets ->
      @Suppress("DEPRECATION")
      val top =
        if (Build.VERSION.SDK_INT >= 30)
          insets.getInsets(android.view.WindowInsets.Type.systemBars()).top
        else insets.systemWindowInsetTop
      @Suppress("DEPRECATION")
      val bottom =
        if (Build.VERSION.SDK_INT >= 30)
          insets.getInsets(android.view.WindowInsets.Type.systemBars()).bottom
        else insets.systemWindowInsetBottom
      layout.setPadding(padding, padding + top, padding, padding + bottom)
      insets
    }
    setContentView(scroll)
  }

  private fun unlocked() {
    check(!isFinishing && !isDestroyed)
    check(!(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked)
  }

  private suspend fun authorizeRecoveryKey(credential: StoredPasskey): ByteArray {
    unlocked()
    external = true
    try {
      val bytes = PasskeyGate(this).recoveryPrf(credential)
      try {
        withTimeout(FOCUS_TIMEOUT_MS) { while (!hasWindowFocus()) delay(FOCUS_POLL_INTERVAL_MS) }
        unlocked()
        currentCoroutineContext().ensureActive()
        return bytes
      } catch (error: Throwable) {
        bytes.fill(0)
        throw error
      }
    } finally {
      external = false
    }
  }

  private fun work(block: suspend () -> Unit) {
    busy = true
    action.isEnabled = false
    scope.launch {
      try {
        unlocked()
        block()
      } catch (_: CancellationException) {
        BackupHost.close(false)
      } catch (_: Exception) {
        message.text =
          "Backup could not be verified. Use the original passkey and an unchanged Gizu backup. Your current wallet has not been replaced. You can retry or cancel."
      } finally {
        busy = false
        action.isEnabled = true
      }
    }
  }

  private fun save() = work {
    val credential = withContext(Dispatchers.IO) { store.load().use { it.credential } }
    val key = authorizeRecoveryKey(credential)
    try {
      encrypted =
        withContext(Dispatchers.IO) {
          store.load().use { record ->
            check(record.credential.credentialId.contentEquals(credential.credentialId))
            BackupCodec.encrypt(record, key)
          }
        }
    } finally {
      key.fill(0)
    }
    unlocked()
    external = true
    try {
      startActivityForResult(
        Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "application/json"
          putExtra(Intent.EXTRA_TITLE, "gizu-wallet-backup.json")
        },
        SAVE_BACKUP_REQUEST,
      )
    } catch (error: Exception) {
      external = false
      throw error
    }
  }

  private fun choose() {
    external = true
    try {
      startActivityForResult(
        Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
          addCategory(Intent.CATEGORY_OPENABLE)
          type = "*/*"
        },
        OPEN_BACKUP_REQUEST,
      )
    } catch (_: Exception) {
      external = false
      BackupHost.close(false)
    }
  }

  @Deprecated("Platform document picker callback")
  override fun onActivityResult(request: Int, result: Int, data: Intent?) {
    super.onActivityResult(request, result, data)
    external = false
    if (result != RESULT_OK || data?.data == null) {
      BackupHost.close(false)
      return
    }
    val uri = data.data!!
    work {
      if (request == SAVE_BACKUP_REQUEST) {
        writeBackup(uri)
      } else if (request == OPEN_BACKUP_REQUEST) verify(uri)
      else error("Unexpected document result")
    }
  }

  private suspend fun writeBackup(uri: Uri) {
    withContext(Dispatchers.IO) {
      contentResolver.openOutputStream(uri, "wt")!!.use { it.write(checkNotNull(encrypted)) }
    }
    encrypted?.fill(0)
    encrypted = null
    saved = true
    message.text =
      "Backup saved. Now reopen that file and confirm your original passkey so Gizu can verify all wallet accounts."
    action.text = "Open saved backup to verify"
  }

  private suspend fun readBackup(uri: Uri): ByteArray {
    return withContext(Dispatchers.IO) {
      contentResolver.openInputStream(uri)!!.use { input ->
        val buffer = ByteArray(MAX_BACKUP_BYTES + 1)
        var count = 0
        while (count < buffer.size) {
          val read = input.read(buffer, count, buffer.size - count)
          if (read == -1) break
          check(read > 0)
          count += read
        }
        require(count in 1..MAX_BACKUP_BYTES)
        buffer.copyOf(count)
      }
    }
  }

  private suspend fun verifyCredentialMatchesWallet(credential: StoredPasskey) {
    if (restore)
      check(
        withContext(Dispatchers.IO) {
          store.state()["status"] in listOf("absent", "recoveryRequired")
        }
      )
    else
      withContext(Dispatchers.IO) {
        store.load().use {
          check(it.credential.credentialId.contentEquals(credential.credentialId))
          check(
            it.credential.publicKeyX.contentEquals(credential.publicKeyX) &&
              it.credential.publicKeyY.contentEquals(credential.publicKeyY)
          )
        }
      }
  }

  private suspend fun verify(uri: Uri) {
    check(restore || saved)
    val bytes = readBackup(uri)
    val credential = BackupCodec.credential(bytes)
    verifyCredentialMatchesWallet(credential)
    val key = authorizeRecoveryKey(credential)
    try {
      withContext(Dispatchers.IO) {
        BackupCodec.decrypt(bytes, key).use { restored ->
          val accounts = deriveAccountAddresses(restored.entropy)
          check(accounts.size == 16)
          if (!restore)
            store.load().use { current ->
              check(
                current.id == restored.id &&
                  MessageDigest.isEqual(current.entropy, restored.entropy)
              )
              check(deriveAccountAddresses(current.entropy) == accounts)
            }
          currentCoroutineContext().ensureActive()
          if (restore) store.restore(restored) else store.markVerified(restored)
        }
      }
    } finally {
      key.fill(0)
      bytes.fill(0)
    }
    unlocked()
    BackupHost.close(true)
  }

  override fun onPause() {
    super.onPause()
    if (!external && !isFinishing) BackupHost.close(false)
  }

  @Deprecated("Platform back")
  override fun onBackPressed() {
    BackupHost.close(false)
  }

  override fun onDestroy() {
    if (observingLock) {
      unregisterReceiver(lockReceiver)
      observingLock = false
    }
    scope.cancel()
    encrypted?.fill(0)
    encrypted = null
    if (BackupHost.screen === this) BackupHost.close(false)
    super.onDestroy()
  }
}
