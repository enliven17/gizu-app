import UIKit

@available(iOS 18.0, *)
@MainActor extension WalletCeremony {
  func journal() throws -> StoredOperationJournal {
    let record = try store.load()
    defer { record.close() }
    return try StoredOperationJournal(store: store, record: record)
  }

  func transfer(_ request: [String: Any]?, id: String? = nil, revision: Int? = nil) async throws
    -> [String: Any]
  {
    let journal = try journal()
    let engine = StoredTransferEngine(store: store, journal: journal)
    self.engine = engine
    let screen = try await presentWalletUI()
    screen.networkLabel = "GIZU · MONAD TESTNET"
    screen.show(
      "Preparing exact transfers…", "Checking fees and transaction status. Nothing has been signed."
    )
    let operation: StoredOperationRecord
    if let request {
      try await reconcile(journal, rpc: StoredMonadRPC())
      try checkAuthorization()
      operation = try engine.create(request)
    } else {
      guard let id, let revision else { throw WalletFailure.invalid }
      operation = try journal.get(id)
      try require(operation.revision == revision)
    }

    operationId = operation.operationId
    let review = try await engine.prepare(operation.operationId, revision: operation.revision)
    try checkAuthorization()
    try await screen.confirm("Review transfer", review.text, action: "Approve and unlock passkey")
    let record = try store.load()
    let credential = record.credential
    let walletId = record.id
    record.close()
    _ = try await authorize(
      credential, walletId: walletId,
      purpose:
        "transfer:v1:\(review.id):\(review.revision):\(digest(Data(review.text.utf8)).base64URL)")
    try checkAuthorization()
    screen.show(
      "Submitting approved transfers…",
      "Cancellation stops remaining work; already submitted transactions cannot be undone.")
    try await engine.execute(review, authority: checkAuthorization)
    engine.close()
    return try journal.get(operation.operationId).publicValue
  }
}
