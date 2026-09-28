import Foundation

internal enum TransferStepStatus: String, Codable {
  case planned, signed, pending, unknown, finalized, reverted
}

internal struct StoredStep: Codable, Equatable {
  var index: Int
  var accountIndex: Int
  var from: String
  var to: String
  var valueWei: String
  var status: TransferStepStatus = .planned
  var raw: String?
  var transactionHash: String?
  var nonce: String?
  var quote: StoredFee?
  var conflict = false
  var terminal: Bool { [TransferStepStatus.finalized, .reverted].contains(status) }
  var publicValue: [String: Any] {
    var result: [String: Any] = [
      "index": index, "accountIndex": accountIndex, "from": from, "to": to, "valueWei": valueWei,
      "status": status.rawValue, "nonceConflict": conflict,
    ]
    if let transactionHash { result["transactionHash"] = transactionHash }
    if let nonce { result["nonce"] = nonce }
    return result
  }
}

internal struct StoredFee: Codable, Equatable {
  var gas: String
  var maxFee: String
  var priorityFee: String
}

internal struct StoredOperationRecord: Codable {
  var operationId: String
  var walletId: String
  var revision = 1
  var cancelled = false
  var steps: [StoredStep]
  var unresolved: [StoredStep] { steps.filter { $0.raw != nil && !$0.terminal } }
  var blocked: Bool {
    !unresolved.isEmpty || (!cancelled && steps.contains { $0.status == .planned })
  }

  var resumable: Bool {
    if !unresolved.isEmpty {
      return unresolved.count == 1 && unresolved[0].status == .signed && !unresolved[0].conflict
    }

    return !cancelled && steps.contains { $0.status == .planned }
  }

  private var publicStatus: String {
    if cancelled { return "cancelled" }
    if steps.allSatisfy(\.terminal) { return "completed" }
    if !unresolved.isEmpty { return "needsAuthorization" }
    return "needsReview"
  }

  var publicValue: [String: Any] {
    [
      "operationId": operationId, "walletId": walletId, "revision": revision,
      "canResume": resumable, "blocked": blocked,
      "status": publicStatus,
      "steps": steps.map(\.publicValue),
    ]
  }
}

internal final class StoredOperationJournal {
  private let store: WalletStorage
  let walletId: String
  private let name: String
  private let aad: Data
  init(store: WalletStorage, record: WalletRecord) throws {
    try require(record.verified)
    self.store = store
    walletId = record.id
    name = "operations-\(record.journalId).enc"
    aad = Data("gizu-stored-operations:v1:\(record.id):\(record.journalId)".utf8)
  }

  func all() throws -> [StoredOperationRecord] {
    if try !store.files.exists(name) { return [] }
    guard let key = try store.keys.existing() else { throw WalletFailure.unavailable }
    var clear = try WalletEnvelope.decrypt(store.files.read(name), key: key, aad: aad)
    defer { clear.wipe() }
    let entries = try JSONDecoder().decode([StoredOperationRecord].self, from: clear)
    try require(
      entries.count <= WalletLimits.activeOperations
        && entries.allSatisfy {
          $0.walletId == walletId && UUID(uuidString: $0.operationId) != nil && $0.revision > 0
            && (1...32).contains($0.steps.count)
        })
    return entries
  }

  private func write(_ entries: [StoredOperationRecord], file: String? = nil) throws {
    guard let key = try store.keys.existing() else { throw WalletFailure.unavailable }
    var clear = try JSONEncoder().encode(entries)
    defer { clear.wipe() }
    try store.files.write(file ?? name, bytes: WalletEnvelope.encrypt(clear, key: key, aad: aad))
  }

  func get(_ id: String) throws -> StoredOperationRecord {
    guard let value = try all().first(where: { $0.operationId == id }) else {
      throw WalletFailure.invalid
    }

    return value
  }

  func create(_ steps: [StoredStep]) throws -> StoredOperationRecord {
    var entries = try all()
    try require(!entries.contains(where: \.blocked))
    entries.removeAll { $0.cancelled && $0.steps.allSatisfy { $0.raw == nil } }
    while try entries.count >= WalletLimits.activeOperations
      || JSONEncoder().encode(entries).count > WalletLimits.journalCompactionBytes
    {
      let oldest = entries[0]
      try require(!oldest.blocked)
      try write([oldest], file: "archive-\(oldest.operationId).enc")
      entries.removeFirst()
    }

    let result = StoredOperationRecord(
      operationId: UUID().uuidString, walletId: walletId, steps: steps)
    entries.append(result)
    try write(entries)
    return result
  }

  @discardableResult func update(
    _ id: String, revision: Int? = nil, _ action: (inout StoredOperationRecord) throws -> Void
  ) throws -> StoredOperationRecord {
    var entries = try all()
    guard let index = entries.firstIndex(where: { $0.operationId == id }) else {
      throw WalletFailure.invalid
    }

    if let revision { try require(entries[index].revision == revision) }
    try action(&entries[index])
    try require(entries[index].revision < Int.max)
    entries[index].revision += 1
    try write(entries)
    return entries[index]
  }
}
