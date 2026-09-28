import Foundation

// Exact bounded decimal arithmetic. Reject oversized RPC values rather than rounding.
internal func quantity(_ hex: String) throws -> Decimal {
  try require(
    hex.range(of: "^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,30})$", options: .regularExpression) != nil)
  return hex.dropFirst(2).reduce(Decimal.zero) { $0 * 16 + Decimal(Int(String($1), radix: 16)!) }
}
internal func decimalValue(_ value: String) throws -> Decimal {
  try require(value.range(of: "^(0|[1-9][0-9]{0,36})$", options: .regularExpression) != nil)
  guard let number = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")) else {
    throw WalletFailure.invalid
  }
  return number
}
internal func decimalText(_ number: Decimal) -> String {
  NSDecimalNumber(decimal: number).stringValue
}
internal func rpcText(_ object: [String: Any], _ key: String) throws -> String {
  guard let text = object[key] as? String else { throw WalletFailure.invalid }
  return text
}
internal func reconcile(_ journal: StoredOperationJournal, rpc: StoredTransferRPC) async throws {
  let operations = try journal.all()
  if operations.allSatisfy({ $0.unresolved.isEmpty }) { return }
  try require(try quantity(await rpc.text("eth_chainId", [])) == 10143)
  for operation in operations {
    var steps = operation.steps
    for index in steps.indices where steps[index].raw != nil && !steps[index].terminal {
      var step = steps[index]
      guard let hash = step.transactionHash, let nonce = step.nonce else {
        throw WalletFailure.invalid
      }
      let receipt = try await rpc.call("eth_getTransactionReceipt", [hash])
      step.conflict = false
      if let receipt = receipt as? [String: Any] {
        try require(
          try rpcText(receipt, "transactionHash").lowercased() == hash.lowercased()
            && rpcText(receipt, "from").lowercased() == step.from.lowercased()
            && rpcText(receipt, "to").lowercased() == step.to.lowercased())
        let block = try rpcText(receipt, "blockNumber")
        guard
          let canonical = try await rpc.call("eth_getBlockByNumber", [block, false])
            as? [String: Any],
          let final = try await rpc.call("eth_getBlockByNumber", ["finalized", false])
            as? [String: Any]
        else { throw WalletFailure.invalid }
        let status = try rpcText(receipt, "status")
        try require(["0x0", "0x1"].contains(status))
        let finalized =
          try rpcText(canonical, "hash").lowercased() == rpcText(receipt, "blockHash").lowercased()
          && quantity(rpcText(final, "number")) >= quantity(block)
        step.status = finalized ? (status == "0x1" ? "finalized" : "reverted") : "pending"
      } else {
        try require(receipt is NSNull)
        let transaction = try await rpc.call("eth_getTransactionByHash", [hash])
        if let tx = transaction as? [String: Any] {
          try require(
            try rpcText(tx, "hash").lowercased() == hash.lowercased()
              && rpcText(tx, "from").lowercased() == step.from.lowercased()
              && quantity(rpcText(tx, "nonce")) == decimalValue(nonce))
          step.status = "pending"
        } else {
          try require(transaction is NSNull)
          let latest = try quantity(
            await rpc.text("eth_getTransactionCount", [step.from, "latest"]))
          let pending = try quantity(
            await rpc.text("eth_getTransactionCount", [step.from, "pending"]))
          let expected = try decimalValue(nonce)
          try require(pending >= latest)
          step.conflict = latest > expected || pending > expected
          step.status =
            !step.conflict && latest == expected && pending == expected ? "signed" : "unknown"
        }
      }
      steps[index] = step
    }
    if steps != operation.steps {
      try journal.update(operation.operationId, revision: operation.revision) { value in
        value.steps = steps
        if steps.contains(where: { $0.status == "reverted" }) { value.cancelled = true }
      }
    }
  }
}
