package io.gizu.storedwallet.swap

import android.content.Context
import android.os.PowerManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Carries an approved swap to the end without its screen. The swap screen hands its engine over
 * after the passkey approval (or unlock); this object drives it while [SwapService] keeps the
 * process in the foreground and shows progress as a notification.
 *
 * The engine's signing authority is unchanged: it still signs only the approved plan and only
 * within its 15-minute session, and its key never leaves memory. When the swap needs the user
 * again (a new review or an unlock), an open swap screen takes the engine back; otherwise the
 * engine is closed, which drops the key, and a notification asks the user to open Gizu.
 */
internal object SwapBackground {
  sealed interface Event {
    data class Progress(val view: Map<String, Any?>) : Event

    /** The swap needs the user; the listener must call [takeBack] to receive the engine. */
    data class NeedsUser(val ui: SwapUi) : Event

    data class Finished(val view: Map<String, Any?>?) : Event
  }

  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var engine: SwapEngine? = null
  private var job: Job? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var listener: ((Event) -> Unit)? = null

  /** The last public status seen, for a screen or notification that attaches later. */
  @Volatile
  var lastView: Map<String, Any?>? = null
    private set

  val running: Boolean
    get() = job?.isActive == true

  fun run(context: Context, active: SwapEngine) {
    check(!running) { "A swap is already running in the background." }
    val app = context.applicationContext
    engine = active
    lastView = runCatching { active.view() }.getOrNull()
    wakeLock =
      (app.getSystemService(Context.POWER_SERVICE) as PowerManager)
        .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gizu:swap")
        .apply { acquire(WAKE_LOCK_TIMEOUT_MS) }
    SwapService.start(app)
    job =
      scope.launch {
        try {
          val ui =
            active.advance { view ->
              lastView = view
              SwapService.update(app, view)
              listener?.invoke(Event.Progress(view))
            }
          when (ui) {
            is SwapUi.Done -> finish(app, ui.view, needsUser = false)
            is SwapUi.Review,
            is SwapUi.Unlock -> {
              lastView = runCatching { active.view() }.getOrNull()
              val screen = listener
              if (screen != null) {
                // An open swap screen continues with the same engine and its key.
                releaseProcessHold(app)
                screen(Event.NeedsUser(ui))
              } else finish(app, lastView, needsUser = true)
            }
          }
        } catch (error: CancellationException) {
          throw error
        } catch (error: Exception) {
          android.util.Log.e("SwapBackground", "background swap stopped", error)
          finish(app, runCatching { active.view() }.getOrNull(), needsUser = true)
        }
      }
  }

  /** Hands the engine to an open swap screen after [Event.NeedsUser]. */
  fun takeBack(): SwapEngine? {
    val taken = engine
    engine = null
    return taken
  }

  /** Stops driving and closes the engine; the saved journal stays for Resume. */
  fun stop(context: Context) {
    job?.cancel()
    job = null
    finish(context.applicationContext, lastView, needsUser = false, announce = false)
  }

  /** Registers the one open swap screen; returns its unregistration. */
  fun listen(screen: (Event) -> Unit): () -> Unit {
    listener = screen
    return { if (listener === screen) listener = null }
  }

  private fun finish(
    app: Context,
    view: Map<String, Any?>?,
    needsUser: Boolean,
    announce: Boolean = true,
  ) {
    lastView = view
    engine?.close()
    engine = null
    releaseProcessHold(app)
    if (announce) SwapService.announce(app, view, needsUser)
    listener?.invoke(Event.Finished(view))
  }

  private fun releaseProcessHold(app: Context) {
    wakeLock?.let { if (it.isHeld) it.release() }
    wakeLock = null
    SwapService.stop(app)
  }

  /** A swap waiting on Aurora can take many minutes; never hold the CPU past an hour. */
  private const val WAKE_LOCK_TIMEOUT_MS = 60 * 60 * 1000L
}
