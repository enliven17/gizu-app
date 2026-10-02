package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.*
import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TokenBalanceSyncLatestObserverTest {
  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  /** The public provider exposes headers/logs but no old contract state. */
  private class Rpc : PortfolioRpc {
    var head = 100
    var fork = "a"
    var reads = 0
    var logs = 0
    var dirty: String? = null
    var amount = "0x1"
    val batches = mutableListOf<Int>()

    fun hash(number: Int) = "0x" + fork.repeat(56) + number.toString(16).padStart(8, '0')

    override suspend fun calls(requests: List<Pair<String, JSONArray>>): List<Any> {
      batches.add(requests.size)
      return requests.map { call(it.first, it.second) }
    }

    override suspend fun call(method: String, params: JSONArray): Any =
      when (method) {
        "eth_chainId" -> "0x1237"
        "eth_getBlockByNumber" -> {
          val tag = params.getString(0)
          val number =
            when (tag) {
              "latest" -> head
              "finalized" -> head - 20
              else -> tag.drop(2).toInt(16)
            }
          JSONObject().put("number", "0x${number.toString(16)}").put("hash", hash(number))
        }
        "eth_call" -> {
          check(params.getJSONObject(1).getString("blockHash") == hash(head)) {
            "Historical state unavailable"
          }
          check(params.getJSONObject(1).getBoolean("requireCanonical"))
          reads++
          amount
        }
        "eth_getLogs" -> {
          logs++
          JSONArray().also { items ->
            val filter = params.getJSONObject(0)
            val topics = filter.getJSONArray("topics")
            val watched = topics.getJSONArray(topics.length() - 1)
            dirty?.let { owner ->
              val topic = "0x" + owner.drop(2).padStart(64, '0')
              if ((0 until watched.length()).any { watched.getString(it) == topic })
                items.put(
                  JSONObject()
                    .put("address", TOKEN)
                    .put("removed", false)
                    .put("blockNumber", filter.getString("toBlock"))
                    .put("topics", JSONArray().put(TRANSFER).put("0x" + "0".repeat(64)).put(topic))
                )
            }
          }
        }
        else -> error(method)
      }
  }

  private class Fixture(count: Int) {
    val file = File()
    val rpc = Rpc()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val owners = (1..count).map { "0x" + it.toString(16).padStart(40, '0') }

    fun sync() = TokenBalanceSync(file, { key }, "wallet", 4663, TOKEN, rpc)

    suspend fun initial() {
      repeat((owners.size + 79) / 80) { sync().read(owners, it.toLong()) }
      assertTrue(sync().read(owners, 99).complete)
    }
  }

  @Test
  fun advancingLatestSamplesDoNotSkipColdOwnersOrAdvanceTheLogCheckpoint() = runBlocking {
    val f = Fixture(200)
    val first = f.sync().read(f.owners, 0)
    assertEquals(80, f.rpc.reads)
    assertFalse(first.complete)
    f.rpc.head = 101
    val second = f.sync().read(f.owners, 1)
    assertEquals(160, f.rpc.reads)
    assertEquals("0x64", second.block)
    f.rpc.head = 102
    val third = f.sync().read(f.owners, 2)
    assertEquals(200, f.rpc.reads)
    assertEquals("0x65", third.block)
    assertEquals("0x66", third.sampleBlock)
    assertTrue(third.syncPending)
    val complete = f.sync().read(f.owners, 3)
    assertTrue(complete.complete)
    assertEquals("0x66", complete.block)
    assertTrue(f.rpc.batches.all { it <= 40 })
  }

  @Test
  fun externalDepositUsesCurrentStateWhileFrozenLogBucketsRemainBounded() = runBlocking {
    val f = Fixture(600)
    f.initial()
    f.rpc.head = 101
    f.rpc.dirty = f.owners.last()
    f.rpc.amount = "0x5"
    val before = f.rpc.logs
    val partial = f.sync().read(f.owners, 31_000)
    assertEquals(8, f.rpc.logs - before)
    assertEquals("0x64", partial.block)
    assertEquals("1", partial.balances[f.owners.last()])
    f.rpc.head = 102
    val resumed = f.sync().read(f.owners, 31_001)
    assertTrue(f.rpc.logs - before <= 16)
    assertEquals("5", resumed.balances[f.owners.last()])
    assertEquals("0x65", resumed.block)
    assertEquals("0x66", resumed.sampleBlock)
    assertTrue(resumed.syncPending)
  }

  @Test
  fun latestReorgKeepsItsBoundedReconciliationProgressAcrossAdvancingHeads() = runBlocking {
    val f = Fixture(600)
    f.initial()
    f.rpc.head = 101
    f.rpc.fork = "b"
    f.rpc.amount = "0x7"
    val originalReads = f.rpc.reads
    var snapshot = f.sync().read(f.owners, 31_000)
    assertTrue(snapshot.stale)
    assertFalse(snapshot.complete)
    repeat(7) { index ->
      f.rpc.head++
      val before = f.rpc.reads
      snapshot = f.sync().read(f.owners, 31_001 + index.toLong())
      assertTrue(f.rpc.reads - before <= 80)
    }
    assertEquals(600, f.rpc.reads - originalReads)
    assertTrue(snapshot.balances.values.all { it == "7" })
    assertEquals("0x65", snapshot.block)
    assertTrue(snapshot.syncPending)
    repeat(2) { index -> snapshot = f.sync().read(f.owners, 31_010 + index.toLong()) }
    assertTrue(snapshot.complete)
    assertTrue(f.rpc.batches.all { it <= 40 })
  }

  companion object {
    const val TOKEN = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168"
    const val TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"
  }
}
