package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnLiquidityCancellationRecoveryTest {
  private val owner = "0x" + "1".repeat(40)
  private val recipient = "0x" + "2".repeat(40)
  private val originalHash = "0x" + "a".repeat(64)
  private val cancellationHash = "0x" + "b".repeat(64)
  private val block = "0x" + "c".repeat(64)

  private class File : WalletFile {
    var bytes: ByteArray? = null

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      this.bytes = bytes.copyOf()
    }
  }

  private fun original() =
    JSONObject()
      .put("operationId", "return-1")
      .put("revision", 7)
      .put("kind", "returnEth")
      .put("quoteId", "return-quote")
      .put("chainId", 1)
      .put("expectedFrom", owner)
      .put("confidentialAccount", recipient)
      .put("recipient", recipient)
      .put("amountAtoms", "1000")
      .put("nonce", 4)
      .put("deadline", 100)
      .put("gasLimit", 21000)
      .put("maxFeePerGasWei", "10")
      .put("priorityFeePerGasWei", "0")

  private fun cancellation() =
    JSONObject()
      .put("kind", "cancelPendingLiquidity")
      .put("operationId", "return-1")
      .put("revision", 2)
      .put("chainId", 1)
      .put("expectedFrom", owner)
      .put("confidentialAccount", recipient)
      .put("nonce", 4)
      .put("deadline", 400)
      .put("originalRawTransaction", "0xf8abcd")
      .put("originalTransactionHash", originalHash)
      .put("gasLimit", 21000)
      .put("maxFeePerGasWei", "15")
      .put("priorityFeePerGasWei", "0")

  private fun setup(withCancellation: Boolean = true): EarnLiquidityJournal {
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val j = EarnLiquidityJournal(File(), { key }, "wallet", "generation")
    val p = original()
    j.create(p)
    j.update("return-1", 1) { target ->
      target
        .put("raw", "0xoriginal")
        .put("transactionHash", originalHash)
        .put("signingProposal", p)
        .put("stateBinding", JSONObject().put("nonce", "4"))
        .put("status", "unknown")
      if (withCancellation)
        target.put(
          "cancellationAttempts",
          JSONArray()
            .put(
              JSONObject()
                .put("raw", "0xcancellation")
                .put("transactionHash", cancellationHash)
                .put("proposal", cancellation())
                .put("status", "unknown")
            ),
        )
    }
    return j
  }

  private inner class Rpc : TransferRpc {
    var winning: String? = null
    var latest = "0x4"
    var pending = "0x5"
    var canonical = block
    var finalNumber = "0x10"
    var broadcasts = 0
    var knownOriginal = true
    var wrongCancellationTo = false

    override suspend fun call(method: String, params: JSONArray): Any =
      when (method) {
        "eth_chainId" -> "0x1"
        "eth_getTransactionReceipt" ->
          if (params.getString(0) == winning)
            JSONObject()
              .put("transactionHash", winning)
              .put("blockHash", block)
              .put("blockNumber", "0x10")
              .put("status", "0x1")
              .put("gasUsed", "0x5208")
              .put("effectiveGasPrice", if (winning == originalHash) "0xa" else "0xf")
              .put("logs", JSONArray())
          else JSONObject.NULL
        "eth_getTransactionByHash" -> {
          val hash = params.getString(0)
          if (hash != winning && !(hash == originalHash && knownOriginal)) JSONObject.NULL
          else
            JSONObject()
              .put("hash", hash)
              .put("from", owner)
              .put("to", if (hash == originalHash || wrongCancellationTo) recipient else owner)
              .put("input", "0x")
              .put("nonce", "0x4")
              .put("gas", "0x5208")
              .put("value", if (hash == originalHash) "0x3e8" else "0x0")
              .put("type", "0x0")
              .put("gasPrice", if (hash == originalHash) "0xa" else "0xf")
              .put("maxFeePerGas", "0xf")
              .put("maxPriorityFeePerGas", "0x1")
              .put("blockHash", if (hash == winning) block else JSONObject.NULL)
        }
        "eth_getBlockByNumber" ->
          JSONObject()
            .put("hash", canonical)
            .put("number", if (params.getString(0) == "finalized") finalNumber else "0x10")
        "eth_getTransactionCount" -> if (params.getString(1) == "pending") pending else latest
        "eth_getBalance" -> "0x1000"
        "eth_call" -> "0x" + earnNumberWord("0")
        "eth_sendRawTransaction" -> {
          broadcasts++
          error("Recovery is read-only")
        }
        else -> error("Unexpected $method")
      }
  }

  @Test
  fun expiredOriginalRemainsLockedButItsKnownPendingNonceCanBeCancelled() = runBlocking {
    val j = setup(false)
    val rpc = Rpc()
    reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
    assertTrue(j.get("return-1").liquidityBlocked())
    assertEquals(true, j.public(j.get("return-1"))["canCancelPending"])
    assertEquals(0, rpc.broadcasts)
    rpc.knownOriginal = false
    reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
    assertEquals(false, j.public(j.get("return-1"))["canCancelPending"])
  }

  @Test
  fun finalizedCancellationReleasesNonceAndRetainsBothAttemptHashesAndRelocksOnReorg() =
    runBlocking {
      val j = setup()
      val rpc = Rpc()
      rpc.winning = cancellationHash
      rpc.latest = "0x5"
      reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
      val op = j.get("return-1")
      val public = j.public(op)
      assertEquals("nonceCancelled", public["status"])
      assertEquals(false, public["blocked"])
      assertEquals(originalHash, public["transactionHash"])
      assertEquals(cancellationHash, public["cancellationTransactionHash"])
      assertEquals("0xoriginal", op.getString("raw"))
      assertEquals(
        "0xcancellation",
        op.getJSONArray("cancellationAttempts").getJSONObject(0).getString("raw"),
      )
      assertFalse(public.toString().contains("0xcancellation"))
      rpc.canonical = originalHash
      reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
      assertTrue(j.get("return-1").liquidityBlocked())
      assertEquals("cancellationPending", j.public(j.get("return-1"))["status"])
      assertEquals(0, rpc.broadcasts)
    }

  @Test
  fun originalCanWinCancellationRaceAndOnlyItsVerifiedReturnClaimsSettlement() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    rpc.winning = originalHash
    rpc.latest = "0x5"
    reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
    assertEquals("awaitingSettlement", j.public(j.get("return-1"))["status"])
    assertFalse(j.get("return-1").liquidityBlocked())
    assertEquals("210000", j.public(j.get("return-1"))["actualFeeWei"])
    assertEquals(originalHash, j.get("return-1").getString("transactionHash"))
    assertTrue(j.get("return-1").has("cancellationAttempts"))
    assertEquals(0, rpc.broadcasts)
  }

  @Test
  fun nonFinalOrWrongRecipientCancellationCannotReleaseOriginalNonce() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    rpc.winning = cancellationHash
    rpc.latest = "0x5"
    rpc.finalNumber = "0xf"
    reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
    assertTrue(j.get("return-1").liquidityBlocked())
    assertEquals("cancellationPending", j.public(j.get("return-1"))["status"])
    rpc.finalNumber = "0x10"
    rpc.wrongCancellationTo = true
    try {
      reconcileEarnLiquidityOperations(j, rpc, NativeFusionGateway())
      fail("Forged cancellation must fail")
    } catch (_: IllegalStateException) {}
    assertTrue(j.get("return-1").liquidityBlocked())
  }

  @Test
  fun signedRawCannotBecomeUnlockedByDeadlineExpiryAlone() {
    val op = setup(false).get("return-1").put("status", "expired")
    assertTrue(op.liquidityBlocked())
  }
}
