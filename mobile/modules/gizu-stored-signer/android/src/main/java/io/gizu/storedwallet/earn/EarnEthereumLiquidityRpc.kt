package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.*

internal const val ETH_EARN_WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2"
internal const val ETH_FUSION_ROUTER = "0x111111125421ca6dc452d289314280a0f8842a65"
internal const val ETH_FUSION_SETTLEMENT = "0x399740157391a9f1bf4e9921a8834f9bc8f2678e"
internal const val ETH_FUSION_FEE_RECEIVER = "0x90cbe4bdd538d6e9b379bff5fe72c3d67a521de5"
internal const val ETH_NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
internal const val ETH_USDC_ORIGIN_ASSET =
  "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near"
internal const val ETH_NATIVE_ORIGIN_ASSET = "nep141:eth.omft.near"

internal class EarnLiquidityStateLoader(
  private val rpc: TransferRpc,
  private val codeHash: (String) -> String = ::earnContractCodeHash,
) {
  suspend fun load(p: JSONObject): NativeEthereumLiquidityState =
    loadObserved(p, cancellation = false)

  suspend fun loadCancellation(p: JSONObject): NativeEthereumLiquidityState {
    check(p.getString("kind") == "cancelPendingLiquidity")
    earnHash(p.getString("originalTransactionHash"))
    return loadObserved(p, cancellation = true)
  }

  private suspend fun loadObserved(
    p: JSONObject,
    cancellation: Boolean,
  ): NativeEthereumLiquidityState {
    check(quantity(rpc.text("eth_chainId")) == java.math.BigInteger.ONE)
    val owner = p.getString("expectedFrom")
    val word = earnAddressWord(owner)
    val block = rpc.call("eth_getBlockByNumber", JSONArray().put("latest").put(false)) as JSONObject
    requireFreshEarnBlock(block)
    val hash = earnHash(block.getString("hash"))
    val pinned = earnPinnedBlock(hash)
    suspend fun read(method: String, first: Any): String =
      rpc.call(method, JSONArray().put(first).put(pinned)) as String
    suspend fun call(to: String, data: String) =
      read("eth_call", JSONObject().put("to", to).put("data", data))
    suspend fun uint(to: String, data: String) = earnAbiWord(call(to, data)).toString()
    suspend fun held(token: String, holder: String) =
      uint(token, "0x70a08231${earnAddressWord(holder)}")
    suspend fun code(target: String): String =
      read("eth_getCode", target).also { check(it != "0x") }.let(codeHash)
    val pending = quantity(rpc.text("eth_getTransactionCount", owner, "pending"))
    val nonce = quantity(read("eth_getTransactionCount", owner))
    check(pending.bitLength() <= 63)
    if (cancellation)
      check(
        nonce == p.getLong("nonce").toBigInteger() &&
          (pending == nonce || pending == nonce + java.math.BigInteger.ONE)
      )
    else check(pending == nonce)
    check(
      earnAbiWord(call(ETH_EARN_USDC, "0x313ce567")) == 6.toBigInteger() &&
        earnAbiWord(call(ETH_EARN_WETH, "0x313ce567")) == 18.toBigInteger()
    )
    val asset = call(ETH_EARN_VAULT, "0x38d52e0f")
    check(earnAbiWord(asset).toString(16).padStart(40, '0') == ETH_EARN_USDC.drop(2).lowercase())
    val native = quantity(read("eth_getBalance", owner)).toString()
    val usdc = held(ETH_EARN_USDC, owner)
    val weth = held(ETH_EARN_WETH, owner)
    val shares = held(ETH_EARN_VAULT, owner)
    val allowance = uint(ETH_EARN_USDC, "0xdd62ed3e$word${earnAddressWord(ETH_FUSION_ROUTER)}")
    val permitNonce = uint(ETH_EARN_USDC, "0x7ecebe00$word")
    val domain = earnHash(call(ETH_EARN_USDC, "0x3644e515"))
    val slot =
      p.optJSONObject("unsignedOrder")?.let(::liquidityOrderNonce)?.shiftRight(8)?.toString() ?: "0"
    val invalidator = uint(ETH_FUSION_ROUTER, "0x143e86a7$word${earnNumberWord(slot)}")
    val sender = read("eth_getCode", owner)
    val recipient = p.optString("recipient")
    val recipientCode = if (recipient.isNotEmpty()) read("eth_getCode", recipient) else "0x"
    val recipientBalance =
      if (recipient.isEmpty()) "0"
      else if (p.getString("kind") == "returnEth")
        quantity(read("eth_getBalance", recipient)).toString()
      else held(ETH_EARN_USDC, recipient)
    val usdcHash = code(ETH_EARN_USDC)
    val wethHash = code(ETH_EARN_WETH)
    val routerHash = code(ETH_FUSION_ROUTER)
    val settlementHash = code(ETH_FUSION_SETTLEMENT)
    val feeHash = code(ETH_FUSION_FEE_RECEIVER)
    val vaultHash = code(ETH_EARN_VAULT)
    val checked =
      rpc.call("eth_getBlockByNumber", JSONArray().put(block.getString("number")).put(false))
        as JSONObject
    check(earnHash(checked.getString("hash")) == hash)
    return NativeEthereumLiquidityState(
      1uL,
      owner,
      (System.currentTimeMillis() / 1000).toULong(),
      quantity(block.getString("number")).longValueExact().toULong(),
      hash,
      earnHash(block.getString("parentHash")),
      nonce.longValueExact().toULong(),
      native,
      usdc,
      weth,
      shares,
      allowance,
      permitNonce,
      domain,
      slot,
      invalidator,
      sender,
      recipientCode,
      recipientBalance,
      quantity(block.getString("baseFeePerGas")).toString(),
      usdcHash,
      wethHash,
      routerHash,
      settlementHash,
      feeHash,
      vaultHash,
    )
  }
}

internal fun liquidityStateBinding(s: NativeEthereumLiquidityState) =
  JSONObject()
    .put("nonce", s.nonce.toString())
    .put("nativeBalanceWei", s.nativeBalanceWei)
    .put("usdcBalanceAtoms", s.usdcBalanceAtoms)
    .put("shares", s.shares)
    .put("wethBalanceAtoms", s.wethBalanceAtoms)
    .put("permitNonce", s.permitNonce)
    .put("fusionNonceSlot", s.fusionNonceSlot)
    .put("fusionInvalidatorWord", s.fusionInvalidatorWord)
    .put("usdcDomainSeparator", s.usdcDomainSeparator)
    .put("senderCode", s.senderCode)
    .put("recipientCode", s.recipientCode)
    .put("recipientAssetBalanceAtoms", s.recipientAssetBalanceAtoms)
    .put("usdcCodeHash", s.usdcCodeHash)
    .put("wethCodeHash", s.wethCodeHash)
    .put("routerCodeHash", s.routerCodeHash)
    .put("settlementCodeHash", s.settlementCodeHash)
    .put("feeReceiverCodeHash", s.feeReceiverCodeHash)
    .put("vaultCodeHash", s.vaultCodeHash)
