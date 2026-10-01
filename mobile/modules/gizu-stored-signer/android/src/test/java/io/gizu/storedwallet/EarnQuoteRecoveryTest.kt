package io.gizu.storedwallet

import javax.crypto.KeyGenerator
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class EarnQuoteRecoveryTest {
  private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()

  private class File : WalletFile {
    var bytes: ByteArray? = null
    var fail = false

    override fun exists() = bytes != null

    override fun read() = bytes!!.copyOf()

    override fun write(bytes: ByteArray) {
      check(!fail)
      this.bytes = bytes.copyOf()
    }
  }

  private val owner = "0x" + "1".repeat(40)
  private val c = "0x" + "2".repeat(40)
  private val hash = "0x" + "a".repeat(64)

  private fun quote() =
    JSONObject()
      .put("operationId", "source-1")
      .put("revision", 7)
      .put("quoteId", hash)
      .put("chainId", 143)
      .put("token", MONAD_EARN_USDC)
      .put("amountAtoms", "1000000")
      .put("recipient", "0x" + "3".repeat(40))
      .put("confidentialAccount", c)
      .put("refundOwner", owner)
      .put("expiresAt", 600)
      .put("minimumCreditAtoms", "999800")
      .put("originAsset", EARN_MONAD_ASSET)
      .put("providerFeeBps", 2)
      .put("authenticatedBodyHash", hash)
      .put("recoveryEnvelope", "v1.private-server-recovery")

  private fun proposal() =
    quote().put("kind", "sourceFunding").put("deadline", 500).also { it.remove("recoveryEnvelope") }

  private fun journal(f: File, generation: String = "generation") =
    EarnQuoteJournal(f, { key }, "wallet", generation)

  @Test
  fun envelopeIsDurablePrivateAndForwardedForOriginalBindingAfterRestart() = runBlocking {
    val f = File()
    val j = journal(f)
    val first =
      NativeEarnQuoteGateway(
        { endpoint, _ ->
          assertEquals("source-quote", endpoint)
          quote().toString()
        },
        { hash },
        { 100 },
        j,
      )
    val public = first.create(1, "source-1", 7, owner, c, "1000000", false)
    assertFalse(public.containsKey("recoveryEnvelope"))
    assertFalse(String(f.bytes!!).contains("private-server-recovery"))
    val restart =
      NativeEarnQuoteGateway(
        { endpoint, body ->
          assertEquals("quote-binding", endpoint)
          assertEquals("v1.private-server-recovery", JSONObject(body).getString("recoveryEnvelope"))
          quote().toString()
        },
        { hash },
        { 100 },
        journal(f),
      )
    assertEquals("1000000", restart.binding(proposal())!!.binding.amountAtoms)
    assertFalse(
      restart.create(1, "source-1", 7, owner, c, "1000000", false).containsKey("recoveryEnvelope")
    )
    assertThrows(Exception::class.java) { journal(f, "other-generation").get("source-1", 7) }
    Unit
  }

  @Test
  fun changedTupleOrMissingDurableCommitCannotReturnOrReplaceQuote() = runBlocking {
    val f = File()
    val j = journal(f)
    j.save(quote())
    assertThrows(IllegalStateException::class.java) { j.save(quote().put("amountAtoms", "1")) }
    val gateway =
      NativeEarnQuoteGateway({ _, _ -> error("No requote allowed") }, { hash }, { 100 }, j)
    try {
      gateway.create(1, "source-1", 7, owner, c, "1", false)
      fail("Changed amount")
    } catch (_: IllegalStateException) {}
    val failed = File().also { it.fail = true }
    val g =
      NativeEarnQuoteGateway({ _, _ -> quote().toString() }, { hash }, { 100 }, journal(failed))
    try {
      g.create(1, "source-1", 7, owner, c, "1000000", false)
      fail("Commit must precede public result")
    } catch (_: IllegalStateException) {}
    assertNull(failed.bytes)
  }

  @Test
  fun returnQuotesRecoverWithExactTokenAndCannotRenewExpiredNativeAuthority() = runBlocking {
    for ((chain, asset, token, origin) in
      listOf(
        listOf("4663", "usdc", HOOD_EARN_USDG, EARN_HOOD_ASSET),
        listOf("1", "usdc", ETH_EARN_USDC, ETH_USDC_ORIGIN_ASSET),
        listOf("1", "native", ETH_NATIVE_TOKEN, ETH_NATIVE_ORIGIN_ASSET),
      )) {
      val q = quote().put("chainId", chain.toInt()).put("token", token).put("originAsset", origin)
      val f = File()
      journal(f).save(q)
      val g =
        NativeEarnQuoteGateway(
          { endpoint, body ->
            assertEquals("quote-binding", endpoint)
            assertEquals(
              q.getString("recoveryEnvelope"),
              JSONObject(body).getString("recoveryEnvelope"),
            )
            q.toString()
          },
          { hash },
          { 100 },
          journal(f),
        )
      assertEquals(
        token,
        g.create(chain.toInt(), "source-1", 7, owner, c, "1000000", true, asset)["token"],
      )
      val expired = NativeEarnQuoteGateway({ _, _ -> q.toString() }, { hash }, { 601 }, journal(f))
      try {
        expired.create(chain.toInt(), "source-1", 7, owner, c, "1000000", true, asset)
        fail("Cannot renew expired quote")
      } catch (_: IllegalStateException) {}
    }
  }
}
