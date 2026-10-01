package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject

internal fun requireLiquidityTransaction(tx: JSONObject, p: JSONObject, hash: String) {
  val kind = p.getString("kind")
  val native = kind == "returnEth"
  val recipient = if (kind == "fusionUsdcApproval") ETH_FUSION_ROUTER else p.getString("recipient")
  check(
    tx.getString("hash").equals(hash, true) &&
      tx.getString("from").equals(p.getString("expectedFrom"), true)
  )
  check(tx.getString("to").equals(if (native) recipient else ETH_EARN_USDC, true))
  val data =
    if (native) "0x"
    else
      (if (kind == "fusionUsdcApproval") "0x095ea7b3" else "0xa9059cbb") +
        earnAddressWord(recipient) +
        earnNumberWord(p.getString("amountAtoms"))
  check(
    tx.getString("input").equals(data, true) &&
      quantity(tx.getString("nonce")) == p.getLong("nonce").toBigInteger() &&
      quantity(tx.getString("gas")) == p.getLong("gasLimit").toBigInteger()
  )
  check(
    quantity(tx.getString("value")) ==
      if (native) p.getString("amountAtoms").toBigInteger() else java.math.BigInteger.ZERO
  )
  if (native)
    check(
      quantity(tx.getString("type")) == java.math.BigInteger.ZERO &&
        quantity(tx.getString("gasPrice")) == p.getString("maxFeePerGasWei").toBigInteger()
    )
  else
    check(
      quantity(tx.getString("type")) == 2.toBigInteger() &&
        quantity(tx.getString("maxFeePerGas")) == p.getString("maxFeePerGasWei").toBigInteger() &&
        quantity(tx.getString("maxPriorityFeePerGas")) ==
          p.getString("priorityFeePerGasWei").toBigInteger()
    )
}

private fun liquidityLogs(receipt: JSONObject) =
  receipt.getJSONArray("logs").let { rows ->
    check(rows.length() <= 4096)
    (0 until rows.length()).map(rows::getJSONObject)
  }

private fun liquidityTransferAmount(log: JSONObject) = earnAbiWord(log.getString("data"))

internal fun requireLiquidityReceipt(
  p: JSONObject,
  receipt: JSONObject,
  topic: (String) -> String = ::earnEventTopic,
) {
  if (p.getString("kind") == "returnEth") return
  val signature =
    if (p.getString("kind") == "fusionUsdcApproval") "Approval(address,address,uint256)"
    else "Transfer(address,address,uint256)"
  val recipient =
    if (p.getString("kind") == "fusionUsdcApproval") ETH_FUSION_ROUTER else p.getString("recipient")
  val event =
    liquidityLogs(receipt).single { log ->
      val topics = log.getJSONArray("topics")
      log.getString("address").equals(ETH_EARN_USDC, true) &&
        topics.length() == 3 &&
        topics.getString(0).equals(topic(signature), true) &&
        topics.getString(1).equals("0x" + earnAddressWord(p.getString("expectedFrom")), true) &&
        topics.getString(2).equals("0x" + earnAddressWord(recipient), true)
    }
  check(liquidityTransferAmount(event) == p.getString("amountAtoms").toBigInteger())
}

internal fun requireFusionReceipt(
  op: JSONObject,
  receipt: JSONObject,
  topic: (String) -> String = ::earnEventTopic,
) {
  val p = op.getJSONObject("signingProposal")
  val logs = liquidityLogs(receipt)
  val fill =
    logs.single { log ->
      log.getString("address").equals(ETH_FUSION_ROUTER, true) &&
        log.getJSONArray("topics").length() == 1 &&
        log
          .getJSONArray("topics")
          .getString(0)
          .equals(topic("OrderFilled(bytes32,uint256)"), true) &&
        log.getString("data").take(66).equals(op.getString("orderHash"), true)
    }
  val data = fill.getString("data")
  check(
    Regex("0x[0-9a-fA-F]{128}").matches(data) && data.takeLast(64).toBigInteger(16).signum() == 0
  )
  val outgoing =
    logs
      .filter { log ->
        val topics = log.getJSONArray("topics")
        log.getString("address").equals(ETH_EARN_USDC, true) &&
          topics.length() == 3 &&
          topics.getString(0).equals(topic("Transfer(address,address,uint256)"), true) &&
          topics.getString(1).equals("0x" + earnAddressWord(p.getString("expectedFrom")), true)
      }
      .fold(java.math.BigInteger.ZERO) { sum, log -> sum + liquidityTransferAmount(log) }
  check(outgoing == p.getString("inputAtoms").toBigInteger())
}

/**
 * Provider status is only a receipt locator; canonical native chain evidence authorizes completion.
 */
internal suspend fun reconcileEarnLiquidityOperations(
  journal: EarnLiquidityJournal,
  rpc: TransferRpc,
  gateway: NativeFusionGateway,
  topic: (String) -> String = ::earnEventTopic,
) {
  check(quantity(rpc.text("eth_chainId")) == java.math.BigInteger.ONE)
  for (op in journal.all()) {
    if (!op.has("raw") && !op.has("signedOrder") && !op.has("permit")) continue
    if (op.has("raw")) {
      val beforeRaw = op.toString()
      reconcileLiquidityRawOperation(op, rpc, topic)
      if (beforeRaw != op.toString())
        journal.update(op.getString("operationId"), op.getInt("revision")) { target ->
          for (field in
            listOf(
              "status",
              "conflict",
              "cancellationAllowed",
              "cancellationAttempts",
              "cancellationWinningTransactionHash",
              "actualFeeWei",
              "residualShares",
              "residualUsdcAtoms",
              "residualEthWei",
            )) if (op.has(field)) target.put(field, op.get(field))
        }
      continue
    }
    val p = op.optJSONObject("signingProposal") ?: op.getJSONObject("proposal")
    val before = op.toString()
    op.put("conflict", false)
    var hash = op.optString("transactionHash")
    if (op.has("signedOrder")) {
      val provider = gateway.status(op.getString("orderHash"))
      check(provider.getString("orderHash").equals(op.getString("orderHash"), true))
      val fills = provider.getJSONArray("fills")
      check(fills.length() <= 1)
      if (fills.length() == 1) {
        val located = earnHash(fills.getJSONObject(0).getString("transactionHash"))
        check(hash.isEmpty() || hash.equals(located, true))
        hash = located
      }
    }
    val receipt =
      if (hash.isNotEmpty()) rpc.call("eth_getTransactionReceipt", JSONArray().put(earnHash(hash)))
      else JSONObject.NULL
    if (receipt is JSONObject) {
      check(receipt.getString("transactionHash").equals(hash, true))
      val blockHash = earnHash(receipt.getString("blockHash"))
      val number = receipt.getString("blockNumber")
      val canonical =
        rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
      val final =
        rpc.call("eth_getBlockByNumber", JSONArray().put("finalized").put(false)) as JSONObject
      if (
        earnHash(canonical.getString("hash")) != blockHash ||
          quantity(final.getString("number")) < quantity(number)
      )
        op.put("status", "pending")
      else {
        val tx = rpc.call("eth_getTransactionByHash", JSONArray().put(hash)) as JSONObject
        check(
          tx.getString("hash").equals(hash, true) &&
            tx.getString("blockHash").equals(blockHash, true)
        )
        if (op.has("raw")) requireLiquidityTransaction(tx, p, hash)
        val execution = quantity(receipt.getString("status"))
        check(execution in setOf(java.math.BigInteger.ZERO, java.math.BigInteger.ONE))
        val success = execution == java.math.BigInteger.ONE
        if (op.has("signedOrder"))
          check(success) // A resolver revert does not consume the saved order.
        if (success) {
          if (op.has("signedOrder")) requireFusionReceipt(op, receipt, topic)
          else requireLiquidityReceipt(p, receipt, topic)
          val pinned = earnPinnedBlock(blockHash)
          val owner = p.getString("expectedFrom")
          suspend fun uint(token: String) =
            earnAbiWord(
              rpc.call(
                "eth_call",
                JSONArray()
                  .put(
                    JSONObject().put("to", token).put("data", "0x70a08231${earnAddressWord(owner)}")
                  )
                  .put(pinned),
              ) as String
            )
          val native =
            quantity(rpc.call("eth_getBalance", JSONArray().put(owner).put(pinned)) as String)
          if (op.has("signedOrder")) {
            val baseline =
              op.getJSONObject("stateBinding").getString("nativeBalanceWei").toBigInteger()
            check(native >= baseline + p.getString("minimumEthWei").toBigInteger())
            op.put("receivedEthWei", (native - baseline).toString())
          } else {
            val gas = quantity(receipt.getString("gasUsed"))
            val effective = quantity(receipt.getString("effectiveGasPrice"))
            check(
              gas <= p.getLong("gasLimit").toBigInteger() &&
                effective <= p.getString("maxFeePerGasWei").toBigInteger()
            )
            op.put("actualFeeWei", (gas * effective).toString())
            if (p.getString("kind") == "returnEth")
              check(
                gas == 21000.toBigInteger() &&
                  effective == p.getString("maxFeePerGasWei").toBigInteger()
              )
          }
          op
            .put("residualShares", uint(ETH_EARN_VAULT).toString())
            .put("residualUsdcAtoms", uint(ETH_EARN_USDC).toString())
            .put("residualEthWei", native.toString())
        }
        val checked =
          rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
        op
          .put("transactionHash", hash)
          .put(
            "status",
            if (earnHash(checked.getString("hash")) == blockHash) {
              if (success) "finalized" else "reverted"
            } else "pending",
          )
      }
    } else {
      check(receipt === JSONObject.NULL)
      if (op.has("raw")) {
        val known = rpc.call("eth_getTransactionByHash", JSONArray().put(hash))
        if (known is JSONObject) {
          requireLiquidityTransaction(known, p, hash)
          op.put("status", "pending")
        } else {
          check(known === JSONObject.NULL)
          val nonce =
            quantity(rpc.text("eth_getTransactionCount", p.getString("expectedFrom"), "latest"))
          val pending =
            quantity(rpc.text("eth_getTransactionCount", p.getString("expectedFrom"), "pending"))
          val conflict = nonce != p.getLong("nonce").toBigInteger() || pending != nonce
          op.put("conflict", conflict).put("status", if (conflict) "unknown" else "signed")
        }
      } else {
        val final =
          rpc.call("eth_getBlockByNumber", JSONArray().put("finalized").put(false)) as JSONObject
        val finalHash = earnHash(final.getString("hash"))
        val finalTime = quantity(final.getString("timestamp"))
        check(
          finalTime.signum() > 0 &&
            finalTime <= (System.currentTimeMillis() / 1000 + 5).toBigInteger()
        )
        val order = p.getJSONObject("unsignedOrder")
        val nonce = liquidityOrderNonce(order)
        val slot = nonce.shiftRight(8)
        val bits =
          earnAbiWord(
            rpc.call(
              "eth_call",
              JSONArray()
                .put(
                  JSONObject()
                    .put("to", ETH_FUSION_ROUTER)
                    .put(
                      "data",
                      "0x143e86a7${earnAddressWord(p.getString("expectedFrom"))}${earnNumberWord(slot.toString())}",
                    )
                )
                .put(earnPinnedBlock(finalHash)),
            ) as String
          )
        val used = bits.testBit(nonce.and(255.toBigInteger()).toInt())
        val checked =
          rpc.call("eth_getBlockByNumber", JSONArray().put(final.getString("number")).put(false))
            as JSONObject
        check(earnHash(checked.getString("hash")) == finalHash)
        op.put("conflict", used)
        op.put(
          "status",
          if (used) "unknown"
          else if (finalTime > p.getLong("deadline").toBigInteger()) "expired"
          else if (op.has("signedOrder")) "signed" else "permitSaved",
        )
      }
    }
    if (before != op.toString())
      journal.update(op.getString("operationId"), op.getInt("revision")) { target ->
        for (field in
          listOf(
            "status",
            "conflict",
            "transactionHash",
            "actualFeeWei",
            "receivedEthWei",
            "residualShares",
            "residualUsdcAtoms",
            "residualEthWei",
          )) if (op.has(field)) target.put(field, op.get(field))
      }
  }
}

internal fun requireLiquidityCancellationTransaction(tx: JSONObject, p: JSONObject, hash: String) {
  val owner = p.getString("expectedFrom")
  check(
    tx.getString("hash").equals(hash, true) &&
      tx.getString("from").equals(owner, true) &&
      tx.getString("to").equals(owner, true)
  )
  check(
    tx.getString("input") == "0x" &&
      quantity(tx.getString("value")) == java.math.BigInteger.ZERO &&
      quantity(tx.getString("gas")) == 21000.toBigInteger() &&
      quantity(tx.getString("nonce")) == p.getLong("nonce").toBigInteger()
  )
  if (p.getString("originalRawTransaction").startsWith("0x02", true)) {
    check(
      quantity(tx.getString("type")) == 2.toBigInteger() &&
        quantity(tx.getString("maxFeePerGas")) == p.getString("maxFeePerGasWei").toBigInteger() &&
        quantity(tx.getString("maxPriorityFeePerGas")) ==
          p.getString("priorityFeePerGasWei").toBigInteger()
    )
  } else
    check(
      quantity(tx.getString("type")) == java.math.BigInteger.ZERO &&
        quantity(tx.getString("gasPrice")) == p.getString("maxFeePerGasWei").toBigInteger()
    )
}

private data class LiquidityRawAttempt(
  val hash: String,
  val proposal: JSONObject,
  val cancellation: JSONObject?,
  var receipt: JSONObject? = null,
  var knownPending: Boolean = false,
)

/**
 * Every saved same-nonce attempt is retained. Only one canonical finalized receipt releases the
 * nonce.
 */
internal suspend fun reconcileLiquidityRawOperation(
  op: JSONObject,
  rpc: TransferRpc,
  topic: (String) -> String = ::earnEventTopic,
) {
  val p = op.optJSONObject("signingProposal") ?: op.getJSONObject("proposal")
  val cancellations = op.liquidityCancellationAttempts()
  val attempts =
    listOf(LiquidityRawAttempt(op.getString("transactionHash"), p, null)) +
      cancellations.map {
        LiquidityRawAttempt(it.getString("transactionHash"), it.getJSONObject("proposal"), it)
      }
  check(attempts.map { earnHash(it.hash) }.toSet().size == attempts.size)
  val canonical = mutableListOf<LiquidityRawAttempt>()
  var finalizedHeight: java.math.BigInteger? = null
  for (attempt in attempts) {
    check(
      attempt.proposal.getLong("nonce") == p.getLong("nonce") &&
        attempt.proposal.getString("expectedFrom").equals(p.getString("expectedFrom"), true)
    )
    val result = rpc.call("eth_getTransactionReceipt", JSONArray().put(attempt.hash))
    if (result is JSONObject) {
      val hash = earnHash(result.getString("blockHash"))
      val number = result.getString("blockNumber")
      check(result.getString("transactionHash").equals(attempt.hash, true))
      val tx = rpc.call("eth_getTransactionByHash", JSONArray().put(attempt.hash)) as JSONObject
      check(tx.getString("blockHash").equals(hash, true))
      if (attempt.cancellation == null) requireLiquidityTransaction(tx, p, attempt.hash)
      else requireLiquidityCancellationTransaction(tx, attempt.proposal, attempt.hash)
      val execution = quantity(result.getString("status"))
      check(execution in setOf(java.math.BigInteger.ZERO, java.math.BigInteger.ONE))
      val block = rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
      if (earnHash(block.getString("hash")) == hash) {
        attempt.receipt = result
        canonical.add(attempt)
        attempt.cancellation?.put("status", "pending")
        if (finalizedHeight == null)
          finalizedHeight =
            quantity(
              (rpc.call("eth_getBlockByNumber", JSONArray().put("finalized").put(false))
                  as JSONObject)
                .getString("number")
            )
      } else attempt.cancellation?.put("status", "orphaned")
    } else {
      check(result === JSONObject.NULL)
      val known = rpc.call("eth_getTransactionByHash", JSONArray().put(attempt.hash))
      if (known is JSONObject) {
        if (attempt.cancellation == null) requireLiquidityTransaction(known, p, attempt.hash)
        else requireLiquidityCancellationTransaction(known, attempt.proposal, attempt.hash)
        attempt.knownPending = !known.has("blockHash") || known.isNull("blockHash")
        attempt.cancellation?.put("status", "pending")
      } else {
        check(known === JSONObject.NULL)
        attempt.cancellation?.put("status", "unknown")
      }
    }
  }
  // Two canonical receipts for the same sender and nonce cannot both be genuine.
  check(canonical.size <= 1)
  val winner =
    canonical.singleOrNull()?.takeIf {
      quantity(checkNotNull(it.receipt).getString("blockNumber")) <= checkNotNull(finalizedHeight)
    }
  op.put("conflict", false).put("cancellationAllowed", false)
  if (winner != null) {
    val receipt = checkNotNull(winner.receipt)
    val hash = earnHash(receipt.getString("blockHash"))
    val number = receipt.getString("blockNumber")
    val gas = quantity(receipt.getString("gasUsed"))
    val effective = quantity(receipt.getString("effectiveGasPrice"))
    check(
      gas <= winner.proposal.getLong("gasLimit").toBigInteger() &&
        effective <= winner.proposal.getString("maxFeePerGasWei").toBigInteger()
    )
    op.put("actualFeeWei", (gas * effective).toString())
    val success = quantity(receipt.getString("status")) == java.math.BigInteger.ONE
    if (winner.cancellation != null) {
      check(gas == 21000.toBigInteger())
      if (!winner.proposal.getString("originalRawTransaction").startsWith("0x02", true))
        check(effective == winner.proposal.getString("maxFeePerGasWei").toBigInteger())
      op.put("cancellationWinningTransactionHash", winner.hash)
      winner.cancellation.put("status", "finalized")
    } else if (success) {
      requireLiquidityReceipt(p, receipt, topic)
      if (p.getString("kind") == "returnEth")
        check(
          gas == 21000.toBigInteger() && effective == p.getString("maxFeePerGasWei").toBigInteger()
        )
    }
    if (success || winner.cancellation != null) {
      val owner = p.getString("expectedFrom")
      val pinned = earnPinnedBlock(hash)
      suspend fun held(token: String) =
        earnAbiWord(
          rpc.call(
            "eth_call",
            JSONArray()
              .put(JSONObject().put("to", token).put("data", "0x70a08231${earnAddressWord(owner)}"))
              .put(pinned),
          ) as String
        )
      op
        .put("residualShares", held(ETH_EARN_VAULT).toString())
        .put("residualUsdcAtoms", held(ETH_EARN_USDC).toString())
        .put(
          "residualEthWei",
          quantity(rpc.call("eth_getBalance", JSONArray().put(owner).put(pinned)) as String)
            .toString(),
        )
    }
    val checked = rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
    op.put(
      "status",
      if (earnHash(checked.getString("hash")) != hash) {
        if (cancellations.isNotEmpty()) "cancellationPending" else "pending"
      } else if (winner.cancellation != null) "nonceCancelled"
      else if (success) "finalized" else "reverted",
    )
    return
  }
  val nonce = quantity(rpc.text("eth_getTransactionCount", p.getString("expectedFrom"), "latest"))
  val pending =
    quantity(rpc.text("eth_getTransactionCount", p.getString("expectedFrom"), "pending"))
  val originalNonce = p.getLong("nonce").toBigInteger()
  val protectedPending =
    pending == nonce ||
      pending == nonce + java.math.BigInteger.ONE && attempts.any { it.knownPending }
  val conflict = nonce != originalNonce || !protectedPending
  op.put("conflict", conflict).put("cancellationAllowed", !conflict)
  op.put(
    "status",
    if (cancellations.isNotEmpty()) "cancellationPending"
    else if (canonical.isNotEmpty() || attempts.any { it.knownPending }) "pending"
    else if (conflict) "unknown" else "signed",
  )
}
