package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.*
import javax.crypto.KeyGenerator
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class OwnedConfidentialPortfolioTest {
  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private class Fixture {
    val file = File()
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    var now = 100_000L
    var derives = 0
    val record =
      WalletRecord(
        "00000000-0000-4000-8000-000000000001",
        StoredPasskey(byteArrayOf(1), ByteArray(32), ByteArray(32)),
        ByteArray(32),
        earnChain = 1,
        earnCycleIndex = 9,
        earnCycles =
          JSONArray(
              (0..9).map {
                JSONObject().put("cycleIndex", it).put("chainId", 1).put("intentId", "cycle-$it")
              }
            )
            .toString(),
      )

    fun cache() =
      NativeOwnedConfidentialPortfolio(
        file = { file },
        key = { key },
        deriveSwap = { address(200) },
        deriveEarn = { _, _, index ->
          derives++
          address(index.toLong() + 1)
        },
        clock = { now },
      )

    fun observation(target: NativeConfidentialTarget) =
      mapOf<String, Any>(
        "confidentialAddress" to target.address,
        "assetId" to ASSET,
        "available" to "1000000",
        "timestampMs" to now,
        "authenticated" to true,
        "operationScoped" to false,
      )
  }

  @Test
  fun boundedExplicitReadTargetsEventuallyProduceOneAggregateWithoutPublishingOwners() {
    val f = Fixture()
    val cache = f.cache()
    val targets = cache.nextTargets(f.record)
    assertEquals(4, targets.size)
    assertEquals(9, targets.first().cycleIndex)
    targets.forEach { cache.recordValidated(it, f.observation(it)) }
    val partial = cache.snapshot(f.record)
    assertEquals("4000000", partial["confidentialKnownAtoms"])
    assertNull(asset(partial)["balanceAtoms"])
    repeat(4) {
      val reopened = f.cache()
      reopened.nextTargets(f.record).forEach { reopened.recordValidated(it, f.observation(it)) }
    }
    val complete = f.cache().snapshot(f.record)
    assertEquals("11000000", asset(complete)["balanceAtoms"])
    assertEquals(true, complete["confidentialComplete"])
    assertEquals(0, f.cache().nextTargets(f.record).size)
    assertEquals(10, f.derives)
    assertFalse(complete.toString().contains(address(200)))
    assertFalse(String(f.file.bytes!!).contains("cycle-"))
  }

  @Test
  fun expiredReadCacheKeepsKnownAmountsButRequiresManualAuthenticationForATotal() {
    val f = Fixture()
    val cache = f.cache()
    repeat(4) {
      cache.nextTargets(f.record).forEach { cache.recordValidated(it, f.observation(it)) }
    }
    f.now += 31_000
    val stale = cache.snapshot(f.record)
    assertEquals("11000000", stale["confidentialKnownAtoms"])
    assertNull(asset(stale)["balanceAtoms"])
    assertEquals(true, stale["confidentialStale"])
    assertEquals(true, stale["confidentialReadRequired"])
    assertEquals(4, cache.nextTargets(f.record).size)
  }

  @Test
  fun legacyPreparedProfileIncludesItsOriginalConfidentialAccountAlongsideSwapAccountTwo() {
    val f = Fixture()
    val legacy =
      WalletRecord(f.record.id, f.record.credential, f.record.entropy.copyOf(), earnChain = 4663)
    val cache = f.cache()
    val targets = cache.nextTargets(legacy)
    assertEquals(2, targets.size)
    assertEquals(4663, targets.first().profileChainId)
    assertEquals(0, targets.first().cycleIndex)
    assertTrue(targets.any { it.kind == "swap" })
    targets.forEach { cache.recordValidated(it, f.observation(it)) }
    assertEquals("2000000", asset(cache.snapshot(legacy))["balanceAtoms"])
  }

  @Test
  fun cacheRejectsWrongAccountUnsupportedAssetAndOperationCreditMasqueradingAsBalance() {
    val f = Fixture()
    val cache = f.cache()
    val target = cache.nextTargets(f.record).first()
    for (change in
      listOf(
        mapOf("confidentialAddress" to address(900)),
        mapOf("assetId" to "unsupported-token"),
        mapOf("operationScoped" to true),
        mapOf("timestampMs" to 0L),
      )) {
      assertThrows(Exception::class.java) {
        cache.recordValidated(target, f.observation(target) + change)
      }
    }
    assertThrows(Exception::class.java) {
      cache.recordValidated(target.copy(address = address(900)), f.observation(target))
    }
    assertNull(asset(cache.snapshot(f.record))["balanceAtoms"])
  }

  @Suppress("UNCHECKED_CAST")
  private fun asset(snapshot: Map<String, Any?>) =
    (snapshot["ownedAssets"] as List<Map<String, Any?>>).single()

  companion object {
    private const val ASSET = "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx"

    private fun address(n: Long) = "0x" + n.toString(16).padStart(40, '0')
  }
}
