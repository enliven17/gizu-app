package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.earnContractCodeHash

internal fun earnEventTopic(signature: String): String =
  earnContractCodeHash("0x" + signature.toByteArray().joinToString("") { "%02x".format(it) })

private fun topicAddress(topics: JSONArray, index: Int, address: String): Boolean =
  topics.getString(index).equals("0x" + earnAddressWord(address), true)

private fun logWords(log: JSONObject, count: Int): List<java.math.BigInteger> {
  val data = log.getString("data")
  check(Regex("0x[0-9a-fA-F]{${64 * count}}").matches(data))
  return (0 until count).map { data.substring(2 + it * 64, 2 + (it + 1) * 64).toBigInteger(16) }
}

/**
 * Read-only reconciliation, including already-final entries so observed reorgs restore the lock.
 */
internal suspend fun reconcileEarnVaultOperations(
  journal: EarnVaultJournal,
  rpc: TransferRpc,
  eventTopic: (String) -> String = ::earnEventTopic,
) {
  val operations = journal.all()
  if (operations.none { it.steps().any { step -> step.has("raw") } }) return
  check(quantity(rpc.text("eth_chainId")) == java.math.BigInteger.ONE)
  for (op in operations) {
    val before = op.toString()
    val proposal = op.getJSONObject("proposal")
    val owner = proposal.getString("expectedFrom")
    for (step in op.steps()) {
      if (!step.has("raw")) continue
      val hash = step.getString("transactionHash")
      val receipt = rpc.call("eth_getTransactionReceipt", JSONArray().put(hash))
      val tx = rpc.call("eth_getTransactionByHash", JSONArray().put(hash))
      step.put("conflict", false)
      if (tx is JSONObject) requireEarnTransaction(tx, step, owner, hash)
      else check(tx === JSONObject.NULL)
      if (receipt is JSONObject) {
        check(tx is JSONObject)
        check(
          receipt.getString("transactionHash").equals(hash, true) &&
            receipt.getString("from").equals(owner, true) &&
            receipt.getString("to").equals(step.getString("to"), true)
        )
        check(receipt.getString("status") in setOf("0x0", "0x1"))
        val number = receipt.getString("blockNumber")
        val receiptHash = earnHash(receipt.getString("blockHash"))
        val canonical =
          rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
        val final =
          rpc.call("eth_getBlockByNumber", JSONArray().put("finalized").put(false)) as JSONObject
        if (
          earnHash(canonical.getString("hash")) != receiptHash ||
            quantity(final.getString("number")) < quantity(number)
        )
          step.put("status", "pending")
        else {
          if (receipt.getString("status") == "0x1") {
            requireEarnReceiptSemantics(op, step, receipt, eventTopic)
            if (step.getString("to").equals(ETH_EARN_ROUTER, true)) {
              val balance =
                rpc.call(
                  "eth_call",
                  JSONArray()
                    .put(
                      JSONObject()
                        .put("to", ETH_EARN_VAULT)
                        .put("data", "0x70a08231${earnAddressWord(owner)}")
                    )
                    .put(earnPinnedBlock(receiptHash)),
                ) as String
              val observedShares = earnAbiWord(balance)
              if (proposal.getString("kind") == "vaultRedeemAll")
                step.put("residualShares", observedShares.toString())
              else
                check(
                  observedShares >=
                    op.getString("baselineShares").toBigInteger() +
                      step.getString("settledShares").toBigInteger()
                )
            }
          }
          check(quantity(receipt.getString("gasUsed")) <= step.getString("gasLimit").toBigInteger())
          check(
            quantity(receipt.getString("effectiveGasPrice")) <=
              step.getString("maxFeePerGasWei").toBigInteger()
          )
          step.put(
            "actualFeeWei",
            (quantity(receipt.getString("gasUsed")) *
                quantity(receipt.getString("effectiveGasPrice")))
              .toString(),
          )
          // Recheck the exact receipt block after semantic observations before unlocking.
          val checked =
            rpc.call("eth_getBlockByNumber", JSONArray().put(number).put(false)) as JSONObject
          step.put(
            "status",
            if (earnHash(checked.getString("hash")) == receiptHash) {
              if (receipt.getString("status") == "0x1") "finalized" else "reverted"
            } else "pending",
          )
        }
      } else {
        check(receipt === JSONObject.NULL)
        if (tx is JSONObject) step.put("status", "pending")
        else {
          val latest = quantity(rpc.text("eth_getTransactionCount", owner, "latest"))
          val pending = quantity(rpc.text("eth_getTransactionCount", owner, "pending"))
          check(pending >= latest)
          val nonce = step.getString("nonce").toBigInteger()
          val conflict = latest > nonce || pending > nonce
          step
            .put("conflict", conflict)
            .put(
              "status",
              if (!conflict && latest == nonce && pending == nonce) "signed" else "unknown",
            )
        }
      }
    }
    if (before != op.toString())
      journal.update(op.getString("operationId"), op.getInt("revision")) { target ->
        target.put("steps", op.getJSONArray("steps"))
        if (op.steps().any { it.getString("status") == "reverted" }) target.put("cancelled", true)
      }
  }
}

internal fun requireEarnReceiptSemantics(
  op: JSONObject,
  step: JSONObject,
  receipt: JSONObject,
  topic: (String) -> String = ::earnEventTopic,
) {
  val p = op.getJSONObject("proposal")
  val owner = p.getString("expectedFrom")
  val amount = p.getString("amountAtoms").toBigInteger()
  val logs =
    receipt.getJSONArray("logs").let { rows -> (0 until rows.length()).map(rows::getJSONObject) }
  fun matching(address: String, signature: String) =
    logs.filter { log ->
      log.getString("address").equals(address, true) &&
        log.getJSONArray("topics").optString(0).equals(topic(signature), true)
    }
  if (!step.getString("to").equals(ETH_EARN_ROUTER, true)) {
    val approval =
      matching(step.getString("to"), "Approval(address,address,uint256)").single {
        val t = it.getJSONArray("topics")
        t.length() == 3 && topicAddress(t, 1, owner) && topicAddress(t, 2, ETH_EARN_ROUTER)
      }
    check(logWords(approval, 1).single() == amount)
    return
  }
  if (p.getString("kind") == "vaultDeposit") {
    val deposit =
      matching(ETH_EARN_VAULT, "Deposit(address,address,uint256,uint256)").single {
        val t = it.getJSONArray("topics")
        t.length() == 3 && topicAddress(t, 1, ETH_EARN_ROUTER) && topicAddress(t, 2, owner)
      }
    val words = logWords(deposit, 2)
    check(words[0] == amount && words[1].signum() > 0)
    step.put("settledShares", words[1].toString())
  } else {
    val transferred =
      matching(ETH_EARN_VAULT, "Transfer(address,address,uint256)").single {
        val t = it.getJSONArray("topics")
        t.length() == 3 && topicAddress(t, 1, owner) && topicAddress(t, 2, "0x" + "0".repeat(40))
      }
    check(logWords(transferred, 1).single() == amount)
    val withdrawal =
      matching(ETH_EARN_VAULT, "Withdraw(address,address,address,uint256,uint256)").single {
        val t = it.getJSONArray("topics")
        t.length() == 4 &&
          topicAddress(t, 1, ETH_EARN_ROUTER) &&
          topicAddress(t, 2, ETH_EARN_ROUTER) &&
          topicAddress(t, 3, owner)
      }
    val words = logWords(withdrawal, 2)
    check(words[1] == amount)
    // Pinned router redeems owner shares to itself, then forwards all assets (zero referral).
    val payout =
      matching(ETH_EARN_USDC, "Transfer(address,address,uint256)").single {
        val t = it.getJSONArray("topics")
        t.length() == 3 && topicAddress(t, 1, ETH_EARN_ROUTER) && topicAddress(t, 2, owner)
      }
    check(logWords(payout, 1).single() == words[0])
  }
}
