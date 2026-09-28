import Foundation

internal struct TransferQuoteLoader {
  let rpc: StoredTransferRPC

  func load(for steps: [StoredStep], operation: StoredOperationRecord) async throws
    -> [TransferQuote]
  {
    let chain = try await rpc.text("eth_chainId", [])
    let fee = try await rpc.text("eth_gasPrice", [])
    let priority = try await rpc.text("eth_maxPriorityFeePerGas", [])
    var quotes: [TransferQuote] = []
    var nonces: [String: String] = [:]
    var balances: [String: String] = [:]
    let spent = try operation.steps.filter { $0.raw != nil }.reduce(Decimal.zero) { total, step in
      guard let fee = step.quote else { throw WalletFailure.invalid }
      return try total + quantity(fee.maxFee) * Decimal(WalletLimits.nativeTransferGas)
    }

    try require(
      try spent + quantity(fee) * Decimal(WalletLimits.nativeTransferGas * steps.count)
        <= 100_000_000_000_000_000)
    for step in steps {
      if nonces[step.from] == nil {
        nonces[step.from] = try await rpc.text("eth_getTransactionCount", [step.from, "pending"])
      }

      if balances[step.from] == nil {
        balances[step.from] = try await rpc.text("eth_getBalance", [step.from, "pending"])
      }

      let siblings = steps.filter { $0.from == step.from }
      let total = try siblings.reduce(Decimal.zero) { try $0 + decimalValue($1.valueWei) }
      if try quantity(balances[step.from]!) < total + quantity(fee)
        * Decimal(WalletLimits.nativeTransferGas * siblings.count)
      {
        throw WalletFailure.insufficientBalance
      }

      guard let amount = UInt64(step.valueWei) else { throw WalletFailure.invalid }
      let gas = try await rpc.text(
        "eth_estimateGas",
        [
          [
            "from": step.from, "to": step.to, "value": "0x" + String(amount, radix: 16),
            "data": "0x",
          ]
        ])
      let recipient = try await rpc.text("eth_getCode", [step.to, "pending"])
      let sender = try await rpc.text("eth_getCode", [step.from, "pending"])
      quotes.append(
        TransferQuote(
          chainId: chain, nonce: nonces[step.from]!, gas: gas, maxFee: fee, priorityFee: priority,
          balance: balances[step.from]!, recipientCode: recipient, senderCode: sender))
    }

    return quotes
  }
}
