package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.NativePortfolioRpc
import io.gizu.storedwallet.portfolio.RpcPace
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RpcPaceTest {
  private var clock = 0L
  private val pauses = mutableListOf<Long>()

  @Before
  fun fakeTime() {
    RpcPace.reset()
    RpcPace.now = { clock }
    RpcPace.pause = { pauses += it; clock += it }
  }

  @After
  fun realTime() {
    RpcPace.reset()
    RpcPace.now = { System.nanoTime() / 1_000_000 }
    RpcPace.pause = { kotlinx.coroutines.delay(it) }
  }

  private fun ok(id: Int = 1, result: String = "0x1") =
    JSONObject().put("jsonrpc", "2.0").put("id", id).put("result", result)

  private val limited =
    """{"code":-32007,"message":"50/second request limit reached - reduce calls per second"}"""

  @Test
  fun aBatchLargerThanOneSecondsAllowanceIsSpreadOverSeconds() = runBlocking {
    var rows = 0
    val rpc =
      NativePortfolioRpc("https://rpc.monad.xyz") { body ->
        val requests = JSONArray(body)
        rows += requests.length()
        assertTrue("a batch never exceeds the pace", requests.length() <= RpcPace.PER_SECOND)
        JSONArray((1..requests.length()).map { ok(it) }).toString()
      }
    val results = rpc.calls((1..80).map { "eth_getBalance" to JSONArray() })
    assertEquals(80, results.size)
    assertEquals(80, rows)
    // 80 rows at 40 a second need at least one full pause.
    assertTrue("$pauses", pauses.isNotEmpty() && pauses.all { it in 1..1_000 })
  }

  @Test
  fun aRateLimitedAnswerIsRepeatedAfterABackoff() = runBlocking {
    var sends = 0
    val rpc =
      NativePortfolioRpc("https://rpc.monad.xyz") { _ ->
        sends++
        when (sends) {
          1 -> throw RpcFailure(RpcFailureCode.HTTP) // HTTP 429
          2 -> limited
          else -> ok().toString()
        }
      }
    assertEquals("0x1", rpc.call("eth_chainId", JSONArray()))
    assertEquals(3, sends)
    assertTrue("$pauses", pauses.containsAll(listOf(1_100L, 2_200L)))
  }

  @Test
  fun aPersistentLimitOrAnOtherFailureStillFailsInsteadOfLooping() = runBlocking {
    var sends = 0
    val rpc = NativePortfolioRpc("https://rpc.monad.xyz") { _ -> sends++; limited }
    assertThrows(Exception::class.java) { runBlocking { rpc.call("eth_chainId", JSONArray()) } }
    assertEquals("bounded retries", 4, sends)
    var timeouts = 0
    val down =
      NativePortfolioRpc("https://rpc.monad.xyz") { _ ->
        timeouts++
        throw RpcFailure(RpcFailureCode.TIMEOUT)
      }
    assertThrows(RpcFailure::class.java) { runBlocking { down.call("eth_chainId", JSONArray()) } }
    assertEquals("a timeout is not a rate limit", 1, timeouts)
  }
}
