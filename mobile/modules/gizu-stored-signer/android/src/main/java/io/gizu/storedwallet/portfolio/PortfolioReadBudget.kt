package io.gizu.storedwallet.portfolio

import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray

/** Observation-only deadlines; execution RPC transports retain their own policy. */
internal class PortfolioReadBudget(
  private val totalMs: Long = 10_000L,
  private val requestMs: Long = 3_000L,
  private val nanoTime: () -> Long = System::nanoTime,
) {
  private val started = nanoTime()

  fun wrap(upstream: PortfolioRpc, chain: Long? = null): PortfolioRpc =
    object : PortfolioRpc {
      override suspend fun call(method: String, params: JSONArray): Any =
        observed(method) { bounded { upstream.call(method, params) } }

      override suspend fun calls(requests: List<Pair<String, JSONArray>>): List<Any> =
        observed("batch") { bounded { upstream.calls(requests) } }

      private suspend fun <T : Any> observed(method: String, read: suspend () -> T): T {
        PortfolioDiagnostics.event(
          PortfolioDiagnostics.Stage.RPC,
          PortfolioDiagnostics.Reason.STARTED,
          chain,
          method,
        )
        try {
          return read().also {
            PortfolioDiagnostics.event(
              PortfolioDiagnostics.Stage.RPC,
              PortfolioDiagnostics.Reason.READY,
              chain,
              method,
            )
          }
        } catch (failure: Exception) {
          PortfolioDiagnostics.event(
            PortfolioDiagnostics.Stage.RPC,
            PortfolioDiagnostics.Reason.PROVIDER_FAILURE,
            chain,
            method,
            failure,
          )
          throw failure
        }
      }
    }

  private suspend fun <T : Any> bounded(read: suspend () -> T): T {
    val remaining = totalMs - (nanoTime() - started) / 1_000_000L
    if (remaining <= 0L) {
      PortfolioDiagnostics.event(
        PortfolioDiagnostics.Stage.RPC,
        PortfolioDiagnostics.Reason.SOURCE_BUDGET_EXHAUSTED,
      )
      throw PortfolioReadTimeout()
    }
    return withTimeoutOrNull(minOf(requestMs, remaining)) { read() }
      ?: run {
        PortfolioDiagnostics.event(
          PortfolioDiagnostics.Stage.RPC,
          PortfolioDiagnostics.Reason.REQUEST_TIMEOUT,
        )
        throw PortfolioReadTimeout()
      }
  }
}

internal class PortfolioReadTimeout : Exception("Portfolio observation timed out")
