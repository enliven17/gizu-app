package io.gizu.storedwallet.swap

import android.content.Context
import io.gizu.storedwallet.*
import io.gizu.storedwallet.portfolio.*
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import uniffi.gizu_stored_signer_core.*

/**
 * One device-owned snapshot shared by Swap and Earn; refreshes never upload an account catalogue.
 */
internal class MainnetPortfolio(private val context: Context) {
  suspend fun read(
    record: WalletRecord,
    history: List<Map<String, Any?>>,
    includeOwned: Boolean = true,
  ): Map<String, Any?> {
    val indices = publicAccountIndices(record)
    val accounts =
      indices.indices.toList().chunked(64).flatMap { chunk ->
        currentCoroutineContext().ensureActive()
        derivePortfolioAccounts(
          record.entropy,
          record.roleRegistry,
          chunk.first().toUInt(),
          chunk.size.toUInt(),
        )
      }
    val addresses = accounts.map { it.address }
    val sync =
      TokenBalanceSync(
        AndroidWalletFile(context, "gizu-public-balances-${record.journalId}.enc", 4 * 1024 * 1024),
        { checkNotNull(AndroidWalletKeys().existing()) },
        record.id,
        143,
        USDC,
        NativePortfolioRpc("https://rpc.monad.xyz"),
        ::decodePortfolioBalance,
      )
    val snapshot = sync.read(addresses, System.currentTimeMillis())
    val public =
      buildPublicPortfolio(
        record.id,
        record.roleRegistry,
        accounts.map { PortfolioObservation(it, snapshot.balances[it.address.lowercase()]) },
        PortfolioReadState(
          snapshot.checkedAt.toULong(),
          snapshot.block,
          snapshot.complete,
          snapshot.stale,
          snapshot.syncPending,
        ),
      )
    return public.toPublicMap() +
      mapOf("history" to history) +
      if (includeOwned) NativeOwnedPortfolio(context).read(record) else emptyMap()
  }

  companion object {
    const val USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603"
  }
}
