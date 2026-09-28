package io.gizu.storedwallet

import org.json.JSONArray
import org.json.JSONObject

/** Read-only RPC: never broadcasts, signs or assumes a missing receipt means failure. */
internal suspend fun reconcileOperations(journal: OperationJournal, rpc: TransferRpc) {
  val operations = journal.all()
  if (operations.none { it.unresolved() }) return
  check(quantity(rpc.text("eth_chainId")) == 10143.toBigInteger())
  for (operation in operations) {
    val before = operation.toString()
    for (s in operation.steps()) {
      if (!s.has("raw") || s.getString("status") in terminalSteps) continue
      val hash = s.getString("transactionHash")
      val receipt = rpc.call("eth_getTransactionReceipt", JSONArray().put(hash))
      s.put("conflict", false)
      if (receipt is JSONObject) {
        check(receipt.getString("transactionHash").equals(hash, true))
        check(receipt.getString("from").equals(s.getString("from"), true))
        check(receipt.getString("to").equals(s.getString("to"), true))
        val block = receipt.getString("blockNumber")
        val canonical =
          rpc.call("eth_getBlockByNumber", JSONArray().put(block).put(false)) as JSONObject
        val finalBlock =
          rpc.call("eth_getBlockByNumber", JSONArray().put("finalized").put(false)) as JSONObject
        check(receipt.getString("status") in listOf("0x0", "0x1"))
        s.put(
          "status",
          if (
            canonical.getString("hash").equals(receipt.getString("blockHash"), true) &&
              quantity(finalBlock.getString("number")) >= quantity(block)
          ) {
            if (receipt.getString("status") == "0x1") "finalized" else "reverted"
          } else "pending",
        )
      } else {
        check(receipt === JSONObject.NULL)
        val tx = rpc.call("eth_getTransactionByHash", JSONArray().put(hash))
        if (tx is JSONObject) {
          check(
            tx.getString("hash").equals(hash, true) &&
              tx.getString("from").equals(s.getString("from"), true)
          )
          check(quantity(tx.getString("nonce")) == s.getString("nonce").toBigInteger())
          s.put("status", "pending")
        } else {
          check(tx === JSONObject.NULL)
          val latest = quantity(rpc.text("eth_getTransactionCount", s.getString("from"), "latest"))
          val pending =
            quantity(rpc.text("eth_getTransactionCount", s.getString("from"), "pending"))
          val nonce = s.getString("nonce").toBigInteger()
          check(pending >= latest)
          val conflict = latest > nonce || pending > nonce
          s.put("conflict", conflict)
            .put(
              "status",
              if (!conflict && latest == nonce && pending == nonce) "signed" else "unknown",
            )
        }
      }
    }
    if (before != operation.toString())
      journal.update(operation.getString("operationId"), operation.getInt("revision")) { target ->
        target.put("steps", operation.getJSONArray("steps"))
        if (operation.steps().any { it.getString("status") == "reverted" })
          target.put("cancelled", true)
      }
  }
}
