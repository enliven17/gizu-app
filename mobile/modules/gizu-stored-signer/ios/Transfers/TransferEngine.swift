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
    let rows = try TransferProposal.normalized(request, walletID: journal.walletId)
    let record = try store.load()
    defer { record.close() }
    let addresses = try deriveAccountAddresses(entropy: record.entropy)
    let steps = try rows.enumerated().map { index, row -> StoredStep in
      guard let account = row["accountIndex"] as? Int,
        WalletLimits.accountIndices.contains(account),
        let expected = row["expectedFrom"] as? String,
        let to = row["to"] as? String, let amount = row["valueWei"] as? String
      else { throw WalletFailure.invalid }
      try require(expected.lowercased() == addresses[account].lowercased())
      return StoredStep(
        index: index, accountIndex: account, from: addresses[account], to: to, valueWei: amount)
    }

    return try journal.create(steps)
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

      let text = try TransferReviewText.retry(saved, fee: fee, nonce: nonce, hash: hash)
      return StoredReview(
        id: id, revision: operation.revision, text: text, indices: [saved.index], retry: true)
    }

    let steps = operation.steps.filter { $0.status == .planned }
    try require(!steps.isEmpty && !operation.cancelled)
    let quotes = try await TransferQuoteLoader(rpc: rpc).load(for: steps, operation: operation)
    try Task.checkCancellation()
    let proposal: [String: Any] = [
      "kind": "nativeTransfers", "chainId": WalletLimits.chainID,
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
    let core = try TransferOperation(
      proposal: TransferProposal.json(proposal), entropy: record.entropy)
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
    try require(step.status == .signed && !step.conflict)
    try require(try quantity(await rpc.text("eth_chainId", [])) == Decimal(WalletLimits.chainID))
    for tag in ["pending", "latest"] {
      try require(
        try quantity(await rpc.text("eth_getTransactionCount", [step.from, tag]))
          == decimalValue(nonce))
    }

    for address in [step.from, step.to] {
      try require(try await rpc.text("eth_getCode", [address, "pending"]) == "0x")
    }

    if try quantity(await rpc.text("eth_getBalance", [step.from, "pending"])) < decimalValue(
      step.valueWei) + quantity(fee.maxFee) * Decimal(WalletLimits.nativeTransferGas)
    {
      throw WalletFailure.insufficientBalance
    }
  }
  func execute(_ review: StoredReview, authority: () throws -> Void) async throws {
    try require(journal.get(review.id).revision == review.revision)
    try authority()
    if review.retry {
      try await rebroadcastSavedTransaction(review, authority: authority)
      return
    }

    try await signAndSubmitRemainingTransfers(review, authority: authority)
  }

  private func signAndSubmitRemainingTransfers(
    _ review: StoredReview, authority: () throws -> Void
  ) async throws {
    guard let signer else { throw WalletFailure.invalid }
    try signer.approve()
    for index in review.indices {
      try authority()
      let step = try journal.get(review.id).steps[index]
      try require(step.status == .planned)
      let chain = try await rpc.text("eth_chainId", [])
      let nonce = try await rpc.text("eth_getTransactionCount", [step.from, "pending"])
      let recipient = try await rpc.text("eth_getCode", [step.to, "pending"])
      let sender = try await rpc.text("eth_getCode", [step.from, "pending"])
      try authority()
      let signed = try signer.signNext(
        pendingNonce: nonce, chainId: chain, recipientCode: recipient, senderCode: sender)
      // Commit exact signed bytes before any network submission; uncertain responses are recoverable.
      try journal.update(review.id) { value in
        try require(
          !value.cancelled && value.steps[index].status == .planned
            && signed.from.lowercased() == step.from.lowercased() && signed.nonce == step.nonce)
        value.steps[index].raw = signed.rawTransaction
        value.steps[index].transactionHash = signed.transactionHash
        value.steps[index].status = .unknown
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

      if try journal.get(review.id).steps[index].status != .finalized { break }
    }
  }
  private func rebroadcastSavedTransaction(
    _ review: StoredReview, authority: () throws -> Void
  ) async throws {
    let step = try journal.get(review.id).steps[review.indices[0]]
    try await checkRetry(step)
    try authority()
    guard let raw = step.raw, let hash = step.transactionHash else { throw WalletFailure.invalid }
    try journal.update(review.id, revision: review.revision) {
      $0.steps[step.index].status = .unknown
    }

    try require(
      try await rpc.text("eth_sendRawTransaction", [raw]).lowercased() == hash.lowercased())
    try await reconcile(journal, rpc: rpc)
  }
}
