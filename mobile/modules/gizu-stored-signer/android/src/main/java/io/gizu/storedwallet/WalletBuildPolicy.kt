package io.gizu.storedwallet

/** Build type does not grant wallet authority; native ceremonies authorize every operation. */
internal object WalletBuildPolicy {
  fun isAvailable(sdkInt: Int, hasActivity: Boolean): Boolean = sdkInt >= 28 && hasActivity
}
