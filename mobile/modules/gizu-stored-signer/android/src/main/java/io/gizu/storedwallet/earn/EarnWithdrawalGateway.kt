package io.gizu.storedwallet

import org.json.JSONObject
import uniffi.gizu_stored_signer_core.*

internal data class NativePreparedWithdrawal(
  val text: String,
  val credit: NativeEarnReturnedCreditProof,
  val quote: NativeEarnWithdrawalQuoteBinding,
  val payload: String,
  val nonce: String,
  val reference: JSONObject,
  val recoveryEnvelope: String,
)

internal interface WithdrawalGateway {
  fun decode(text: String, fresh: Boolean = true): NativePreparedWithdrawal

  suspend fun prepare(request: JSONObject): NativePreparedWithdrawal

  suspend fun submit(request: JSONObject): JSONObject

  suspend fun settlement(request: JSONObject): JSONObject
}

internal class NativeWithdrawalGateway(
  private val post: suspend (String, String) -> String = { endpoint, body ->
    NativeRpcTransport("$EARN_NATIVE_BACKEND/withdrawal/$endpoint").post(body)
  },
  private val bodyHash: (String) -> String = ::utf8EarnHash,
  private val now: () -> Long = System::currentTimeMillis,
) : WithdrawalGateway {
  override fun decode(text: String, fresh: Boolean): NativePreparedWithdrawal {
    check(text.toByteArray().size <= 1048576)
    val root = JSONObject(text)
    check(root.getBoolean("executionAvailable") && root.getBoolean("nativeJournalRequired"))
    val envelope = root.getString("recoveryEnvelope")
    check(envelope.startsWith("v1.") && envelope.length <= 180000)
    val returned = root.getJSONObject("sourceCredit")
    val wrapper = root.getJSONObject("quote")
    val c = returned.getJSONObject("credit")
    val q = wrapper.getJSONObject("quote")
    val intent = root.getJSONObject("intent")
    check(intent.getString("standard") == "erc191")
    val payload = intent.getString("payload")
    check(payload.toByteArray().size <= 32768)
    val m = JSONObject(payload)
    val nonce = m.getString("nonce")
    check(
      nonce.matches(Regex("[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=")) && nonce != "A".repeat(43) + "="
    )
    if (fresh)
      for (row in listOf(c, q)) {
        check(
          now() - row.getLong("observedAtMs") in 0L..60000L && row.getLong("expiresAtMs") > now()
        )
      }
    val digest = earnHash(bodyHash(text))
    check(q.getString("payloadHash").equals(bodyHash(payload), true))
    val credit =
      NativeEarnSourceCreditProof(
        c.getString("operationId"),
        c.getLong("revision").toULong(),
        c.getLong("profileChainId").toULong(),
        c.getString("sourceQuoteId"),
        c.getString("sourceTransactionHash"),
        c.getString("sourceHistoryId"),
        c.getString("confidentialAccount"),
        c.getString("sourceAssetId"),
        c.getString("sourceToken"),
        c.getLong("sourceChainId").toULong(),
        c.getInt("sourceDecimals").toUInt(),
        c.getString("creditedAtoms"),
        c.getString("privateTokenId"),
        c.getLong("observedAtMs").toULong(),
        c.getLong("expiresAtMs").toULong(),
        digest,
        c.getString("sourceOwner"),
      )
    val feePolicy = nativeEarnFeePolicy(q, "feeBps", "withdrawal")
    val quote =
      NativeEarnPayoutQuoteBinding(
        q.getString("operationId"),
        q.getLong("revision").toULong(),
        q.getLong("profileChainId").toULong(),
        q.getString("leg"),
        q.getString("quoteId"),
        q.getString("depositId"),
        q.getString("confidentialAccount"),
        q.getString("refundAccount"),
        q.getString("sourceQuoteId"),
        q.getString("sourceTransactionHash"),
        q.getString("sourceHistoryId"),
        digest,
        q.getString("sourceAssetId"),
        q.getString("privateTokenId"),
        q.getString("amountAtoms"),
        q.getString("destinationToken"),
        q.getString("destinationRecipient"),
        q.getString("minimumDestinationAtoms"),
        q.getLong("deadlineMs").toULong(),
        q.getLong("observedAtMs").toULong(),
        q.getLong("expiresAtMs").toULong(),
        digest,
        q.getString("payloadHash"),
        q.getInt("feeBps").toUInt(),
        feePolicy,
        q.getInt("integratorFeeBps").toUInt(),
        q.getString("applicationFeeAtoms"),
        q.getString("confidentiality"),
        q.getString("swapType"),
        q.getString("depositType"),
        q.getString("recipientType"),
        q.getString("refundType"),
      )
    check(
      wrapper.getLong("destinationChainId") == 143L &&
        q.getLong("destinationChainId") == 143L &&
        q.getString("leg") == "withdrawal" &&
        q.getString("destinationToken").equals(MONAD_EARN_USDC, true)
    )
    earnHash(q.getString("referenceHash"))
    earnNumberWord(q.getString("referenceBlock"))
    earnNumberWord(q.getString("initialDestinationAtoms"))
    return NativePreparedWithdrawal(
      text,
      NativeEarnReturnedCreditProof(returned.getString("returnOperationId"), credit),
      NativeEarnWithdrawalQuoteBinding(143uL, quote),
      payload,
      nonce,
      JSONObject(q.toString()),
      envelope,
    )
  }

  override suspend fun prepare(request: JSONObject) = decode(post("prepare", request.toString()))

  override suspend fun submit(request: JSONObject) = JSONObject(post("submit", request.toString()))

  override suspend fun settlement(request: JSONObject): JSONObject {
    val text = post("settlement", request.toString())
    check(text.toByteArray().size <= 1048576)
    return JSONObject(text).put("nativeTlsBodyHash", earnHash(bodyHash(text)))
  }
}
