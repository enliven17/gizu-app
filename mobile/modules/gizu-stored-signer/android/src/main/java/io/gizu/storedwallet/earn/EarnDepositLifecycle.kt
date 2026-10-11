package io.gizu.storedwallet

/** Credential focus loss is allowed; a user departure or screen lock permanently revokes it. */
internal class EarnDepositLifecycle(private val revoke: () -> Unit) {
  fun onSystemEvent(action: String?, reason: String?) {
    if (
      action == "android.intent.action.SCREEN_OFF" ||
        (action == "android.intent.action.CLOSE_SYSTEM_DIALOGS" &&
          reason in setOf("homekey", "recentapps", "globalactions"))
    )
      revoke()
  }

  fun onUserLeave(providerActive: Boolean) {
    if (!providerActive) revoke()
  }

  fun onBackground(providerActive: Boolean, interactive: Boolean, locked: Boolean) {
    if (!providerActive || !interactive || locked) revoke()
  }
}
