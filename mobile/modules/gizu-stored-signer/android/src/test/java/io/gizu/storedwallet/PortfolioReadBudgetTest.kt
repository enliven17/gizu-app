package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.*
import kotlinx.coroutines.*
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class PortfolioReadBudgetTest {
  @Test
  fun providerDeadlineCancelsInFlightReadAndReturnsObservationFailure() = runBlocking {
    var cancelled = false
    val rpc =
      object : PortfolioRpc {
        override suspend fun call(method: String, params: JSONArray): Any {
          try {
            awaitCancellation()
          } finally {
            cancelled = true
          }
        }
      }
    try {
      PortfolioReadBudget(100L, 20L).wrap(rpc).call("eth_chainId", JSONArray())
      fail("Deadline must fail")
    } catch (_: PortfolioReadTimeout) {
      assertTrue(cancelled)
    }
  }

  @Test
  fun expiredSourceBudgetDoesNotStartAnotherNetworkRequest() = runBlocking {
    var now = 0L
    var calls = 0
    val rpc =
      object : PortfolioRpc {
        override suspend fun call(method: String, params: JSONArray): Any {
          calls++
          return "0x1237"
        }
      }
    val bounded = PortfolioReadBudget(50L, 20L, { now }).wrap(rpc)
    assertEquals("0x1237", bounded.call("eth_chainId", JSONArray()))
    now = 51_000_000L
    try {
      bounded.call("eth_chainId", JSONArray())
      fail("No budget remains")
    } catch (_: PortfolioReadTimeout) {
      assertEquals(1, calls)
    }
  }

  @Test
  fun callerCancellationRemainsCancellation() = runBlocking {
    val started = CompletableDeferred<Unit>()
    var cancelled = false
    var ordinaryFailure = false
    val rpc =
      object : PortfolioRpc {
        override suspend fun call(method: String, params: JSONArray): Any {
          started.complete(Unit)
          try {
            awaitCancellation()
          } finally {
            cancelled = true
          }
        }
      }
    val job = launch {
      try {
        PortfolioReadBudget().wrap(rpc).call("eth_chainId", JSONArray())
      } catch (_: PortfolioReadTimeout) {
        ordinaryFailure = true
      }
    }
    started.await()
    job.cancelAndJoin()
    assertTrue(cancelled)
    assertFalse(ordinaryFailure)
  }
}
