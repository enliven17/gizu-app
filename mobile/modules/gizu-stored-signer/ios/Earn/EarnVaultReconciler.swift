import Foundation

internal func requireEarnTransaction(
  _ tx: [String: Any], step: EarnVaultStep, owner: String, hash: String
) throws {
  for (field, expected) in [("hash", hash), ("from", owner), ("to", step.to), ("input", step.data)]
  {
    try require(try rpcText(tx, field).lowercased() == expected.lowercased())
  }
  for (field, expected) in [
    ("gas", step.gasLimit), ("maxFeePerGas", step.maxFeePerGasWei),
    ("maxPriorityFeePerGas", step.priorityFeePerGasWei), ("nonce", step.nonce), ("value", "0"),
  ] {
    try require(try earnQuantityValue(value: rpcText(tx, field)) == expected)
  }
}

internal func requireEarnReceiptSemantics(
  _ op: EarnVaultRecord, step: inout EarnVaultStep, receipt: [String: Any]
) throws {
  guard let logs = receipt["logs"] as? [[String: Any]] else { throw WalletFailure.invalid }
  let p = op.proposal
  func single(_ address: String, _ signature: String, _ parties: [String]) throws -> [String: Any] {
    let topic = try earnContractCodeHash(
      code: "0x" + Data(signature.utf8).map { String(format: "%02x", $0) }.joined())
    let expected = try [topic] + parties.map { "0x" + (try EarnValues.addressWord($0)) }
    let matching = logs.filter { log in
      (log["address"] as? String)?.lowercased() == address.lowercased()
        && (log["topics"] as? [String])?.map { $0.lowercased() } == expected
    }
    try require(matching.count == 1)
    return matching[0]
  }
  func words(_ log: [String: Any], count: Int) throws -> [String] {
    let data = try rpcText(log, "data")
    try require(
      data.range(of: "^0x[0-9a-fA-F]{\(64 * count)}$", options: .regularExpression) != nil)
    return try (0..<count).map { index in
      try decodePortfolioBalance(value: "0x" + data.dropFirst(2 + index * 64).prefix(64))
    }
  }
  if step.to.lowercased() != EarnValues.router.lowercased() {
    let approval = try single(
      step.to, "Approval(address,address,uint256)", [p.expectedFrom, EarnValues.router])
    try require(try words(approval, count: 1)[0] == p.amountAtoms)
  } else if p.kind == "vaultDeposit" {
    let deposit = try single(
      EarnValues.vault, "Deposit(address,address,uint256,uint256)",
      [EarnValues.router, p.expectedFrom])
    let values = try words(deposit, count: 2)
    try require(values[0] == p.amountAtoms && values[1] != "0")
    step.settledShares = values[1]
  } else {
    let burn = try single(
      EarnValues.vault, "Transfer(address,address,uint256)",
      [p.expectedFrom, "0x" + String(repeating: "0", count: 40)])
    try require(try words(burn, count: 1)[0] == p.amountAtoms)
    let withdrawal = try single(
      EarnValues.vault, "Withdraw(address,address,address,uint256,uint256)",
      [EarnValues.router, EarnValues.router, p.expectedFrom])
    let values = try words(withdrawal, count: 2)
    try require(values[1] == p.amountAtoms)
    let payout = try single(
      EarnValues.usdc, "Transfer(address,address,uint256)", [EarnValues.router, p.expectedFrom])
    try require(try words(payout, count: 1)[0] == values[0])
  }
}

/// Only observes. Never signs or rebroadcasts; reorgs restore the nonce lock.
internal func reconcileEarnVault(_ journal: EarnVaultJournal, rpc: StoredTransferRPC) async throws {
  let operations = try journal.all()
  if !operations.contains(where: { $0.steps.contains { $0.raw != nil } }) { return }
  try require(try earnQuantityValue(value: await rpc.text("eth_chainId", [])) == "1")
  for original in operations {
    var op = original
    for index in op.steps.indices {
      try Task.checkCancellation()
      var step = op.steps[index]
      guard step.raw != nil, let hash = step.transactionHash else { continue }
      let owner = op.proposal.expectedFrom
      let receipt = try await rpc.call("eth_getTransactionReceipt", [hash])
      let tx = try await rpc.call("eth_getTransactionByHash", [hash])
      step.conflict = false
      if let tx = tx as? [String: Any] {
        try requireEarnTransaction(tx, step: step, owner: owner, hash: hash)
      } else {
        try require(tx is NSNull)
      }
      if let receipt = receipt as? [String: Any] {
        try require(tx is [String: Any])
        for (field, expected) in [("transactionHash", hash), ("from", owner), ("to", step.to)] {
          try require(try rpcText(receipt, field).lowercased() == expected.lowercased())
        }
        let success = try rpcText(receipt, "status")
        try require(["0x0", "0x1"].contains(success))
        let number = try rpcText(receipt, "blockNumber")
        let receiptHash = try EarnValues.hash(rpcText(receipt, "blockHash"))
        let canonical = try EarnValues.object(
          await rpc.call("eth_getBlockByNumber", [number, false]))
        let final = try EarnValues.object(
          await rpc.call("eth_getBlockByNumber", ["finalized", false]))
        if try EarnValues.hash(rpcText(canonical, "hash")) != receiptHash
          || EarnValues.uint(rpcText(final, "number")) < EarnValues.uint(number)
        {
          step.status = "pending"
        } else {
          if success == "0x1" {
            try requireEarnReceiptSemantics(op, step: &step, receipt: receipt)
            if step.to.lowercased() == EarnValues.router.lowercased() {
              let balance = try await rpc.text(
                "eth_call",
                [
                  ["to": EarnValues.vault, "data": "0x70a08231" + EarnValues.addressWord(owner)],
                  EarnValues.pinned(receiptHash),
                ])
              let observed = try decodePortfolioBalance(value: balance)
              if op.proposal.kind == "vaultRedeemAll" {
                step.residualShares = observed
              } else {
                guard let baseline = op.baselineShares, let shares = step.settledShares else {
                  throw WalletFailure.invalid
                }
                try require(
                  try EarnValues.atLeast(observed, earnAmountSum(values: [baseline, shares])))
              }
            }
          }
          let gasUsed = try earnQuantityValue(value: rpcText(receipt, "gasUsed"))
          let price = try earnQuantityValue(value: rpcText(receipt, "effectiveGasPrice"))
          try require(
            try EarnValues.atLeast(step.gasLimit, gasUsed)
              && EarnValues.atLeast(step.maxFeePerGasWei, price))
          step.actualFeeWei = try earnAmountProduct(left: gasUsed, right: price)
          let checked = try EarnValues.object(
            await rpc.call("eth_getBlockByNumber", [number, false]))
          step.status =
            try EarnValues.hash(rpcText(checked, "hash")) == receiptHash
            ? (success == "0x1" ? "finalized" : "reverted") : "pending"
        }
      } else {
        try require(receipt is NSNull)
        if tx is [String: Any] {
          step.status = "pending"
        } else {
          let latest = try EarnValues.uint(
            await rpc.text("eth_getTransactionCount", [owner, "latest"]))
          let pending = try EarnValues.uint(
            await rpc.text("eth_getTransactionCount", [owner, "pending"]))
          guard let nonce = UInt64(step.nonce) else { throw WalletFailure.invalid }
          try require(pending >= latest)
          step.conflict = latest > nonce || pending > nonce
          step.status = !step.conflict && latest == nonce && pending == nonce ? "signed" : "unknown"
        }
      }
      op.steps[index] = step
    }
    try Task.checkCancellation()
    if try EarnValues.json(original) != EarnValues.json(op) {
      try journal.update(op.operationId, revision: op.revision) { target in
        target.steps = op.steps
        if op.steps.contains(where: { $0.status == "reverted" }) { target.cancelled = true }
      }
    }
  }
}
