package io.gizu.storedwallet.swap

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * Keeps the process in the foreground while [SwapBackground] carries an approved swap, and shows
 * its progress. It holds no wallet data and makes no decisions; tapping a notification only opens
 * the app, where Swap shows the saved status.
 */
class SwapService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notification = progressNotification(this, SwapBackground.lastView)
    if (Build.VERSION.SDK_INT >= 29)
      startForeground(PROGRESS_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    else startForeground(PROGRESS_ID, notification)
    // If Android kills the process, the key is gone; the saved journal resumes from the app.
    return START_NOT_STICKY
  }

  /** Android 15 limits data-sync services; stop driving and leave the swap resumable. */
  override fun onTimeout(startId: Int, fgsType: Int) {
    SwapBackground.stop(this)
    SwapService.announce(this, SwapBackground.lastView, needsUser = true)
    stopSelf()
  }

  companion object {
    private const val PROGRESS_CHANNEL = "gizu_swap_progress"
    private const val ACTION_CHANNEL = "gizu_swap_action"
    private const val PROGRESS_ID = 4401
    private const val RESULT_ID = 4402

    fun start(context: Context) {
      channels(context)
      context.getSystemService(NotificationManager::class.java).cancel(RESULT_ID)
      val intent = Intent(context, SwapService::class.java)
      if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
      else context.startService(intent)
    }

    fun update(context: Context, view: Map<String, Any?>) {
      if (!SwapBackground.running) return
      context
        .getSystemService(NotificationManager::class.java)
        .notify(PROGRESS_ID, progressNotification(context, view))
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, SwapService::class.java))
      context.getSystemService(NotificationManager::class.java).cancel(PROGRESS_ID)
    }

    /** The outcome once the background run ends: finished, paused, or waiting for the user. */
    fun announce(context: Context, view: Map<String, Any?>?, needsUser: Boolean) {
      channels(context)
      val phase = view?.get("phase") as? String
      val (title, text) =
        when {
          phase == "COMPLETE" -> "Swap completed" to "Open Gizu to see the result."
          phase == "PAUSED" ->
            "Swap paused" to "Open Gizu and check Swap to resume or cancel it."
          needsUser ->
            "Swap needs you" to "Open Gizu and press Resume in Swap to continue."
          else -> return
        }
      context
        .getSystemService(NotificationManager::class.java)
        .notify(RESULT_ID, builder(context, ACTION_CHANNEL, title, text).setAutoCancel(true).build())
    }

    private fun progressNotification(context: Context, view: Map<String, Any?>?): Notification {
      val symbol = (view?.get("targetSymbol") as? String).orEmpty().ifBlank { "tokens" }
      val title =
        if (view?.get("direction") == "sell") "Selling $symbol" else "Buying $symbol"
      val step = SwapScreens.stepText(view?.get("step") as? String ?: "", symbol)
      return builder(context, PROGRESS_CHANNEL, title, "$step. You can leave Gizu; this continues.")
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setProgress(0, 0, true)
        .build()
    }

    private fun builder(context: Context, channel: String, title: String, text: String) =
      (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel)
        else @Suppress("DEPRECATION") Notification.Builder(context))
        .setSmallIcon(context.applicationInfo.icon)
        .setContentTitle(title)
        .setContentText(text)
        .setStyle(Notification.BigTextStyle().bigText(text))
        .setContentIntent(openApp(context))

    private fun openApp(context: Context): PendingIntent? {
      val launch =
        context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
      return PendingIntent.getActivity(
        context,
        0,
        launch,
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
      )
    }

    private fun channels(context: Context) {
      if (Build.VERSION.SDK_INT < 26) return
      val manager = context.getSystemService(NotificationManager::class.java)
      manager.createNotificationChannel(
        NotificationChannel(PROGRESS_CHANNEL, "Swap progress", NotificationManager.IMPORTANCE_LOW)
      )
      manager.createNotificationChannel(
        NotificationChannel(ACTION_CHANNEL, "Swap results", NotificationManager.IMPORTANCE_DEFAULT)
      )
    }
  }
}
