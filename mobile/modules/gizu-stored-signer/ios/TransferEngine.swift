import Foundation

internal struct StoredReview {
  let id: String
  let revision: Int
  let text: String
  let indices: [Int]
  let retry: Bool
}
@MainActor internal final class StoredTransferEngine {
  private let store: WalletStorage
  let journal: StoredOperationJournal
  private let rpc: StoredTransferRPC
  private var signer: TransferOperation?
  init(
    store: WalletStorage, journal: StoredOperationJournal, rpc: StoredTransferRPC = StoredMonadRPC()
  ) {
    self.store = store
    self.journal = journal
    self.rpc = rpc
  }
  func close() {
    signer?.invalidate()
    signer = nil
  }
  func create(_ request: [String: Any]) throws -> StoredOperationRecord {
    try require(
      Set(request.keys) == Set(["walletId", "chainId", "transfers"])
        && request["walletId"] as? String == journal.walletId)
    var proposal = request
    proposal.removeValue(forKey: "walletId")
    proposal["kind"] = "nativeTransfers"
    proposal["chainId"] = try exactInteger(proposal["chainId"], range: 10143...10143)
    guard var rows = proposal["transfers"] as? [[String: Any]] else { throw WalletFailure.invalid }
    for index in rows.indices {
      rows[index]["accountIndex"] = try exactInteger(rows[index]["accountIndex"], range: 0...15)
    }
    proposal["transfers"] = rows
    let text = try json(proposal)
    try validateTransferProposal(proposal: text)
    let record = try store.load()
    defer { record.close() }
    let addresses = try deriveAccountAddresses(entropy: record.entropy)
    let steps = try rows.enumerated().map { index, row -> StoredStep in
      guard let account = row["accountIndex"] as? Int, (0...15).contains(account),
        let expected = row["expectedFrom"] as? String,
        let to = row["to"] as? String, let amount = row["valueWei"] as? String
      else { throw WalletFailure.invalid }
      try require(expected.lowercased() == addresses[account].lowercased())
      return StoredStep(
        index: index, accountIndex: account, from: addresses[account], to: to, valueWei: amount)
    }
    return try journal.create(steps)
  }
  private func exactInteger(_ value: Any?, range: ClosedRange<Int>) throws -> Int {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      throw WalletFailure.invalid
    }
    let value = number.doubleValue
    try require(
      value.isFinite && value >= Double(range.lowerBound) && value <= Double(range.upperBound)
        && value.rounded() == value)
    return Int(value)
  }
  private func json(_ object: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try require(data.count <= 65536)
    guard let text = String(data: data, encoding: .utf8) else { throw WalletFailure.invalid }
    return text
  }
  func prepare(_ id: String, revision: Int) async throws -> StoredReview {
    try require(journal.get(id).revision == revision)
    try await reconcile(journal, rpc: rpc)
    let operation = try journal.get(id)
    try require(operation.resumable)
    if let saved = operation.unresolved.first {
      try await checkRetry(saved)
      guard let fee = saved.quote, let nonce = saved.nonce, let hash = saved.transactionHash else {
        throw WalletFailure.invalid
      }
      let text =
        "Retry exactly this previously signed transaction. No new signature or fee change.\n\nAccount \(saved.accountIndex)\nFrom \(saved.from)\nTo \(saved.to)\nAmount \(decimalText(try decimalValue(saved.valueWei) / 1_000_000_000_000_000_000)) MON\nNonce \(nonce)\nGas \(decimalText(try quantity(fee.gas)))\nMax fee/gas \(decimalText(try quantity(fee.maxFee))) wei\nPriority/gas \(decimalText(try quantity(fee.priorityFee))) wei\nMaximum fee \(decimalText(try quantity(fee.maxFee) * 21000)) wei\nHash \(hash)\n\nChain 10143 · Monad testnet. Refresh status before resuming remaining steps."
      return StoredReview(
        id: id, revision: operation.revision, text: text, indices: [saved.index], retry: true)
    }
    let steps = operation.steps.filter { $0.status == "planned" }
    try require(!steps.isEmpty && !operation.cancelled)
    let chain = try await rpc.text("eth_chainId", [])
    let fee = try await rpc.text("eth_gasPrice", [])
    let priority = try await rpc.text("eth_maxPriorityFeePerGas", [])
    var quotes: [TransferQuote] = []
    var nonces: [String: String] = [:]
    var balances: [String: String] = [:]
    let spent = try operation.steps.filter { $0.raw != nil }.reduce(Decimal.zero) { total, step in
      guard let fee = step.quote else { throw WalletFailure.invalid }
      return try total + quantity(fee.maxFee) * 21000
    }
    try require(try spent + quantity(fee) * Decimal(21000 * steps.count) <= 100_000_000_000_000_000)
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
        * Decimal(21000 * siblings.count)
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
    try Task.checkCancellation()
    let proposal: [String: Any] = [
      "kind": "nativeTransfers", "chainId": 10143,
      "transfers": steps.map {
        [
          "accountIndex": $0.accountIndex, "expectedFrom": $0.from, "to": $0.to,
          "valueWei": $0.valueWei,
        ] as [String: Any]
      },
    ]
    let record = try store.load()
    defer { record.close() }
    try require(record.verified && record.id == journal.walletId)
    let core = try TransferOperation(proposal: json(proposal), entropy: record.entropy)
    signer = core
    let review = try core.prepare(quotes: quotes)
    var occurrences: [String: Int] = [:]
    let updated = try journal.update(id, revision: operation.revision) { operation in
      for (step, quote) in zip(steps, quotes) {
        let offset = occurrences[step.from, default: 0]
        occurrences[step.from] = offset + 1
        operation.steps[step.index].nonce = decimalText(try quantity(quote.nonce) + Decimal(offset))
        operation.steps[step.index].quote = StoredFee(
          gas: quote.gas, maxFee: quote.maxFee, priorityFee: quote.priorityFee)
      }
    }
    return StoredReview(
      id: id, revision: updated.revision,
      text: "\(steps.count) remaining transfer(s). Completed transfers will not repeat.\n\n"
        + review, indices: steps.map(\.index), retry: false)
  }
  private func checkRetry(_ step: StoredStep) async throws {
    guard let nonce = step.nonce, let fee = step.quote else { throw WalletFailure.invalid }
    try require(step.status == "signed" && !step.conflict)
    try require(try quantity(await rpc.text("eth_chainId", [])) == 10143)
    for tag in ["pending", "latest"] {
      try require(
        try quantity(await rpc.text("eth_getTransactionCount", [step.from, tag]))
          == decimalValue(nonce))
    }
    for address in [step.from, step.to] {
      try require(try await rpc.text("eth_getCode", [address, "pending"]) == "0x")
    }
    if try quantity(await rpc.text("eth_getBalance", [step.from, "pending"])) < decimalValue(
      step.valueWei) + quantity(fee.maxFee) * 21000
    {
      throw WalletFailure.insufficientBalance
    }
  }
  func execute(_ review: StoredReview, authority: () throws -> Void) async throws {
    try require(journal.get(review.id).revision == review.revision)
    try authority()
    if review.retry {
      let step = try journal.get(review.id).steps[review.indices[0]]
      try await checkRetry(step)
      try authority()
      guard let raw = step.raw, let hash = step.transactionHash else { throw WalletFailure.invalid }
      try journal.update(review.id, revision: review.revision) {
        $0.steps[step.index].status = "unknown"
      }
      try require(
        try await rpc.text("eth_sendRawTransaction", [raw]).lowercased() == hash.lowercased())
      try await reconcile(journal, rpc: rpc)
      return
    }
    guard let signer else { throw WalletFailure.invalid }
    try signer.approve()
    for index in review.indices {
      try authority()
      let step = try journal.get(review.id).steps[index]
      try require(step.status == "planned")
      let chain = try await rpc.text("eth_chainId", [])
      let nonce = try await rpc.text("eth_getTransactionCount", [step.from, "pending"])
      let recipient = try await rpc.text("eth_getCode", [step.to, "pending"])
      let sender = try await rpc.text("eth_getCode", [step.from, "pending"])
      try authority()
      let signed = try signer.signNext(
        pendingNonce: nonce, chainId: chain, recipientCode: recipient, senderCode: sender)
      try journal.update(review.id) { value in
        try require(
          !value.cancelled && value.steps[index].status == "planned"
            && signed.from.lowercased() == step.from.lowercased() && signed.nonce == step.nonce)
        value.steps[index].raw = signed.rawTransaction
        value.steps[index].transactionHash = signed.transactionHash
        value.steps[index].status = "unknown"
      }
      try authority()
      try require(
        try await rpc.text("eth_sendRawTransaction", [signed.rawTransaction]).lowercased()
          == signed.transactionHash.lowercased())
      try await reconcile(journal, rpc: rpc)
      for _ in 0..<3 {
        if try journal.get(review.id).steps[index].terminal { break }
        try await Task.sleep(nanoseconds: 1_000_000_000)
        try authority()
        try await reconcile(journal, rpc: rpc)
      }
      if try journal.get(review.id).steps[index].status != "finalized" { break }
    }
  }
}
