package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.NativeSponsoredState

class EarnSponsoredReconcilerTest {
  private val owner = "0x" + "1".repeat(40)
  private val recipient = "0x" + "2".repeat(40)
  private val hash = "0x" + "a".repeat(64)
  private val block = "0x" + "b".repeat(64)
  private val transaction = "0x" + "c".repeat(64)

  private fun topic(value: String) =
    "0x" +
      when {
        value.startsWith("UserOperation") -> "d"
        value.startsWith("Transfer") -> "e"
        else -> "f"
      }.repeat(64)

  private fun log(address: String, signature: String, indexed: List<String>, values: List<Int>) =
    JSONObject()
      .put("address", address)
      .put("topics", JSONArray(listOf(topic(signature)) + indexed))
      .put("data", "0x" + values.joinToString("") { it.toString(16).padStart(64, '0') })

  private fun address(value: String) = "0x" + earnAddressWord(value)

  private fun transfer(from: String, to: String, amount: Int, token: String = MONAD_EARN_USDC) =
    log(
      token,
      "Transfer(address,address,uint256)",
      listOf(address(from), address(to)),
      listOf(amount),
    )

  private fun setup(kind: String = "sourceFunding"): EarnSponsoredJournal {
    val file =
      object : WalletFile {
        var bytes: ByteArray? = null

        override fun exists() = bytes != null

        override fun read() = bytes!!.copyOf()

        override fun write(bytes: ByteArray) {
          this.bytes = bytes.copyOf()
        }
      }
    val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    val j = EarnSponsoredJournal(file, { key }, "wallet", "generation")
    val chain = if (kind == "sourceFunding") 143 else 4663
    val p =
      JSONObject()
        .put("operationId", "op")
        .put("revision", 7)
        .put("kind", kind)
        .put("chainId", chain)
        .put("expectedFrom", owner)
        .put("recipient", recipient)
        .put("token", if (chain == 143) MONAD_EARN_USDC else HOOD_EARN_USDG)
        .put("amountAtoms", "1000")
        .put("nonce", "0x0")
        .put("maximumTokenFeeAtoms", "100")
    val unsigned =
      JSONObject()
        .put("sender", owner)
        .put("nonce", "0x0")
        .put("callData", "0x1234")
        .put("signature", "0xsigned")
    j.create(p, unsigned)
    j.saveSigned(
      "op",
      1,
      hash,
      unsigned.toString(),
      "review",
      hash,
      JSONObject().put("transactionNonce", "4").put("shares", "0"),
    )
    return j
  }

  private inner class Rpc : TransferRpc {
    var canonical = block
    var receipt: Any = JSONObject.NULL
    var known: Any = JSONObject.NULL
    var paid = 50
    var burn = 1000
    var shares = 0
    var redeem = false

    override suspend fun call(method: String, params: JSONArray): Any =
      when (method) {
        "eth_chainId" -> if (redeem) "0x1237" else "0x8f"
        "eth_getUserOperationReceipt" -> receipt
        "eth_getUserOperationByHash" -> known
        "eth_getBlockByNumber" -> JSONObject().put("number", "0x10").put("hash", canonical)
        "eth_getTransactionReceipt" -> {
          val logs =
            mutableListOf(
              log(
                EARN_ENTRY_POINT,
                "UserOperationEvent(bytes32,address,address,uint256,bool,uint256,uint256)",
                listOf(hash, address(owner), address(EARN_PAYMASTER)),
                listOf(0, 1, 30, 20),
              )
            )
          if (redeem) {
            logs.add(transfer(owner, "0x" + "0".repeat(40), burn, HOOD_EARN_VAULT))
            logs.add(
              log(
                HOOD_EARN_VAULT,
                "Withdraw(address,address,address,uint256,uint256)",
                listOf(address(HOOD_EARN_ROUTER), address(HOOD_EARN_ROUTER), address(owner)),
                listOf(900, 1000),
              )
            )
            logs.add(transfer(HOOD_EARN_ROUTER, owner, 900, HOOD_EARN_USDG))
          } else logs.add(transfer(owner, recipient, 1000))
          logs.add(
            transfer(owner, EARN_PAYMASTER, paid, if (redeem) HOOD_EARN_USDG else MONAD_EARN_USDC)
          )
          JSONObject()
            .put("transactionHash", transaction)
            .put("blockHash", block)
            .put("blockNumber", "0x10")
            .put("status", "0x1")
            .put("logs", JSONArray(logs))
        }
        "eth_call" -> "0x" + shares.toString(16).padStart(64, '0')
        else -> error("Unexpected $method")
      }

    fun found(j: EarnSponsoredJournal) {
      known =
        JSONObject()
          .put("entryPoint", EARN_ENTRY_POINT)
          .put("userOperation", JSONObject(j.get("op").getString("signedUserOperation")))
      receipt =
        JSONObject()
          .put("userOpHash", hash)
          .put("sender", owner)
          .put("nonce", "0x0")
          .put("entryPoint", EARN_ENTRY_POINT)
          .put("success", true)
          .put("actualGasCost", "0x1e")
          .put("actualGasUsed", "0x14")
          .put(
            "receipt",
            JSONObject()
              .put("transactionHash", transaction)
              .put("blockHash", block)
              .put("blockNumber", "0x10"),
          )
    }
  }

  private fun state() =
    NativeSponsoredState(
      143uL,
      owner,
      100uL,
      10uL,
      hash,
      block,
      "0x0",
      4uL,
      4uL,
      "10000000",
      "100",
      "0",
      "0",
      "0",
      MONAD_EARN_USDC,
      6u,
      "0x",
      "0x",
      "1",
      hash,
      hash,
      hash,
      hash,
      hash,
      hash,
    )

  @Test
  fun absentUserOpRemainsLockedAndConflictingNonceCannotResume() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    reconcileEarnSponsoredOperations(
      j,
      rpc,
      rpc,
      ::topic,
      { state().copy(entryPointNonce = "0x1") },
    )
    assertEquals("unknown", j.public(j.get("op"))["status"])
    assertEquals(true, j.public(j.get("op"))["blocked"])
    assertEquals(false, j.public(j.get("op"))["canResume"])
  }

  @Test
  fun canonicalSourceReceiptReleasesNonceButCannotClaimConfidentialCredit() = runBlocking {
    val j = setup()
    val rpc = Rpc()
    rpc.found(j)
    reconcileEarnSponsoredOperations(
      j,
      rpc,
      rpc,
      ::topic,
      { error("Receipt path must not relabel fresh state") },
    )
    assertEquals("awaitingSettlement", j.public(j.get("op"))["status"])
    assertEquals(false, j.public(j.get("op"))["blocked"])
    assertEquals("50", j.public(j.get("op"))["actualTokenFeeAtoms"])
    rpc.canonical = hash
    reconcileEarnSponsoredOperations(
      j,
      rpc,
      rpc,
      ::topic,
      { error("Receipt path must not load latest") },
    )
    assertEquals("pending", j.public(j.get("op"))["status"])
    assertEquals(true, j.public(j.get("op"))["blocked"])
  }

  @Test
  fun providerEchoAndOverchargedFeeCannotFinalize() = runBlocking {
    for (change in listOf("signature", "fee")) {
      val j = setup()
      val rpc = Rpc()
      rpc.found(j)
      if (change == "signature")
        (rpc.known as JSONObject).getJSONObject("userOperation").put("signature", "0xforged")
      else rpc.paid = 101
      try {
        reconcileEarnSponsoredOperations(j, rpc, rpc, ::topic, { state() })
        fail("Changed signed bytes/fee must fail")
      } catch (_: IllegalStateException) {}
      assertTrue(j.get("op").sponsoredBlocked())
      assertNotEquals("finalized", j.get("op").getString("status"))
    }
  }

  @Test
  fun fullRedemptionEventUnlocksExecutedNonceEvenWithUnsolicitedResidualShare() = runBlocking {
    val j = setup("hoodRedeemAll")
    val rpc = Rpc()
    rpc.redeem = true
    rpc.shares = 1
    rpc.found(j)
    reconcileEarnSponsoredOperations(j, rpc, rpc, ::topic, { error("No latest observation") })
    assertEquals("residualShares", j.public(j.get("op"))["status"])
    assertEquals("1", j.public(j.get("op"))["residualShares"])
    assertFalse(j.get("op").sponsoredBlocked())
    val other = setup("hoodRedeemAll")
    rpc.burn = 999
    rpc.found(other)
    try {
      reconcileEarnSponsoredOperations(other, rpc, rpc, ::topic, { state() })
      fail("Partial burn must fail")
    } catch (_: IllegalStateException) {}
    assertTrue(other.get("op").sponsoredBlocked())
  }
}
