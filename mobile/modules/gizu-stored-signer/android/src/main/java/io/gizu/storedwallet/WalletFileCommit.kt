package io.gizu.storedwallet

import java.io.IOException

/** Each commit step must throw on failure; logging a failure is not persistence. */
internal interface WalletFileCommit {
  fun writeAndSync(bytes: ByteArray)

  fun replace()

  fun syncParent()

  fun readCommitted(): ByteArray

  fun discardPending()
}

internal fun commitWalletFile(bytes: ByteArray, commit: WalletFileCommit) {
  try {
    commit.writeAndSync(bytes)
    commit.replace()
    commit.syncParent()
    if (!commit.readCommitted().contentEquals(bytes))
      throw IOException("Storage verification failed")
  } finally {
    // Never roll back the committed file: a failure after rename has an uncertain outcome.
    commit.discardPending()
  }
}
