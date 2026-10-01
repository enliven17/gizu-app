package io.gizu.storedwallet.swap

import android.content.Context
import io.gizu.storedwallet.*
import io.gizu.storedwallet.portfolio.*
import java.math.BigInteger

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
    val addresses = indices.map { publicAccountAddress(record, it) }
    val sync =
      TokenBalanceSync(
        AndroidWalletFile(context, "gizu-public-balances-${record.journalId}.enc", 4 * 1024 * 1024),
        { checkNotNull(AndroidWalletKeys().existing()) },
        record.id,
        143,
        USDC,
        NativePortfolioRpc("https://rpc.monad.xyz"),
      )
    val snapshot = sync.read(addresses, System.currentTimeMillis())
    val balances = addresses.map { snapshot.balances[it.lowercase()]?.toBigInteger() }
    val total = balances.filterNotNull().fold(BigInteger.ZERO, BigInteger::add)
    val funding = balances[1] ?: BigInteger.ZERO
    return mapOf(
      "walletId" to record.id,
      "chainId" to 143,
      "asset" to "USDC",
      "decimals" to 6,
      "fundingAddress" to addresses[1],
      "fundingAtoms" to funding.toString(),
      "returnAtoms" to total.subtract(funding).toString(),
      "totalAtoms" to total.toString(),
      "checkedAt" to snapshot.checkedAt,
      "block" to snapshot.block,
      "stale" to snapshot.stale,
      "balanceComplete" to snapshot.complete,
      "syncPending" to snapshot.syncPending,
      "accounts" to
        indices.mapIndexedNotNull { i, index ->
          val held = balances[i] ?: return@mapIndexedNotNull null
          if (i > 1 && held.signum() == 0) null
          else
            mapOf(
              "address" to addresses[i],
              "accountIndex" to index,
              "role" to if (i <= 1) "funding" else "receiving",
              "balanceAtoms" to held.toString(),
            )
        },
      "history" to history,
    ) + if (includeOwned) NativeOwnedPortfolio(context).read(record) else emptyMap()
  }

  companion object {
    const val USDC = "0x754704bc059f8c67012fed69bc8a327a5aafb603"
  }
}
