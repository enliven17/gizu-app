package io.gizu.storedwallet.portfolio

import uniffi.gizu_stored_signer_core.PublicPortfolioSnapshot

/** Expo serialization only; financial rules and omitted zero rows are owned by Rust. */
internal fun PublicPortfolioSnapshot.toPublicMap(): Map<String, Any?> =
  mapOf(
    "walletId" to walletId,
    "chainId" to chainId.toLong(),
    "asset" to asset,
    "decimals" to decimals.toInt(),
    "fundingAddress" to fundingAddress,
    "fundingAtoms" to fundingAtoms,
    "returnAtoms" to returnAtoms,
    "totalAtoms" to totalAtoms,
    "checkedAt" to checkedAt.toLong(),
    "block" to block,
    "balanceComplete" to balanceComplete,
    "stale" to stale,
    "syncPending" to syncPending,
    "accounts" to
      accounts.map {
        mapOf(
          "accountIndex" to it.accountIndex.toInt(),
          "address" to it.address,
          "role" to it.role,
          "balanceAtoms" to it.balanceAtoms,
        )
      },
  )
