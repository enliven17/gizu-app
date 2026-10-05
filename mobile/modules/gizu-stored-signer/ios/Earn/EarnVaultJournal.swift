import Foundation

internal struct EarnVaultProposal: Codable {
  let kind: String
  let operationId: String
  var revision: UInt64
  let chainId: UInt64
  let expectedFrom: String
  let vault: String
  let token: String
  let router: String
  let amountAtoms: String
  var deadline: UInt64
  let slippageBps: UInt32
  var nonce: UInt64
  var gasLimits: [UInt64]
  let maxFeePerGasWei: String
  let priorityFeePerGasWei: String
  let maximumGasCostWei: String
  let withdrawalReserveWei: String
  let cycleIndex: UInt32

  static func parse(_ request: [String: Any], walletId: String, owner: String) throws -> Self {
    let required: Set<String> = [
      "kind", "operationId", "revision", "chainId", "expectedFrom", "vault", "token", "router",
      "amountAtoms", "deadline", "slippageBps", "nonce", "gasLimits", "maxFeePerGasWei",
      "priorityFeePerGasWei", "maximumGasCostWei", "withdrawalReserveWei", "walletId",
    ]
    try require(
      required.isSubset(of: Set(request.keys))
        && Set(request.keys).isSubset(of: required.union(["cycleIndex"])))
    try require(request["walletId"] as? String == walletId)
    guard let expected = request["expectedFrom"] as? String,
      expected.lowercased() == owner.lowercased(), let gas = request["gasLimits"] as? [Any]
    else { throw WalletFailure.invalid }
    for field in ["revision", "chainId", "deadline", "slippageBps", "nonce"] {
      _ = try EarnValues.exactInteger(request[field]!)
    }
    if let cycle = request["cycleIndex"] { _ = try EarnValues.exactInteger(cycle) }
    for value in gas { _ = try EarnValues.exactInteger(value) }
    var canonical = request
    canonical.removeValue(forKey: "walletId")
    canonical["expectedFrom"] = owner
    canonical["cycleIndex"] = request["cycleIndex"] ?? 0
    let result = try JSONDecoder().decode(
      Self.self, from: JSONSerialization.data(withJSONObject: canonical))
    try require(result.chainId == 1 && ["vaultDeposit", "vaultRedeemAll"].contains(result.kind))
    return result
  }
}

internal struct EarnVaultStep: Codable {
  var index: Int
  let to: String
  let data: String
  let valueWei: String
  let nonce: String
  let gasLimit: String
  let maxFeePerGasWei: String
  let priorityFeePerGasWei: String
  var status: String = "planned"
  var raw: String?
  var transactionHash: String?
  var conflict = false
  var residualShares: String?
  var settledShares: String?
  var actualFeeWei: String?
  var terminal: Bool { ["finalized", "reverted"].contains(status) }
  init(_ call: EarnExecutionCall, index: Int) {
    self.index = index
    to = call.to
    data = call.data
    valueWei = call.valueWei
    nonce = String(call.nonce)
    gasLimit = String(call.gasLimit)
    maxFeePerGasWei = call.maxFeePerGasWei
    priorityFeePerGasWei = call.priorityFeePerGasWei
  }
}
internal struct EarnVaultBinding: Codable, Equatable {
  let tokenCodeHash: String
  let vaultCodeHash: String
  let routerCodeHash: String
  let vaultAsset: String
  let tokenDecimals: UInt32
  init(_ state: EarnExecutionState) {
    tokenCodeHash = state.tokenCodeHash
    vaultCodeHash = state.vaultCodeHash
    routerCodeHash = state.routerCodeHash
    vaultAsset = state.vaultAsset.lowercased()
    tokenDecimals = state.tokenDecimals
  }
}
internal struct EarnVaultRecord: Codable {
  let operationId: String
  let walletId: String
  var revision: UInt32 = 1
  let proposal: EarnVaultProposal
  var cancelled = false
  var steps: [EarnVaultStep] = []
  var reviewHash: String?
  var review: String?
  var baselineShares: String?
  var signingProposal: EarnVaultProposal?
  var stateBinding: EarnVaultBinding?
  var unresolved: [EarnVaultStep] { steps.filter { $0.raw != nil && !$0.terminal } }
  var complete: Bool { !steps.isEmpty && steps.allSatisfy { $0.status == "finalized" } }
  var blocked: Bool {
    !unresolved.isEmpty
      || (!cancelled && (steps.isEmpty || steps.contains { $0.status == "planned" }))
  }
  var canResume: Bool {
    (unresolved.count == 1 && unresolved[0].status == "signed" && !unresolved[0].conflict)
      || (unresolved.isEmpty && !complete && !cancelled)
  }
  var publicValue: [String: Any] {
    get throws {
      let status: String
      if complete {
        status =
          proposal.kind == "vaultDeposit"
          ? "invested" : (steps.last?.residualShares ?? "0") == "0" ? "withdrawn" : "residualShares"
      } else if steps.contains(where: { $0.status == "reverted" }) {
        status = "reverted"
      } else if !unresolved.isEmpty {
        status = "pending"
      } else {
        status = cancelled ? "cancelled" : "needsReview"
      }
      return [
        "operationId": operationId, "walletId": walletId, "revision": revision,
        "kind": proposal.kind, "from": proposal.expectedFrom, "amountAtoms": proposal.amountAtoms,
        "residualShares": steps.last?.residualShares ?? "0",
        "actualFeeWei": try earnAmountSum(
          values: steps.filter(\.terminal).map { $0.actualFeeWei ?? "0" }),
        "blocked": blocked, "canResume": canResume, "status": status,
        "steps": steps.map { step -> [String: Any] in
          var value: [String: Any] = [
            "index": step.index, "to": step.to, "nonce": step.nonce,
            "status": step.status, "nonceConflict": step.conflict,
          ]
          if let hash = step.transactionHash { value["transactionHash"] = hash }
          if step.terminal, let fee = step.actualFeeWei { value["actualFeeWei"] = fee }
          return value
        },
      ]
    }
  }
}

/// An authenticated wallet-generation journal. No signed payloads leave the native boundary.
internal final class EarnVaultJournal {
  let walletId: String
  let generation: String
  private let store: WalletStorage
  private let name: String
  private let aad: Data
  private struct Contents: Codable {
    let version: Int
    let walletId: String
    var operations: [EarnVaultRecord]
  }
  init(store: WalletStorage, record: WalletRecord) {
    self.store = store
    walletId = record.id
    generation = record.journalId
    name = "gizu-earn-vault-\(generation).enc"
    aad = Data("gizu-earn-vault:v1:\(walletId):\(generation)".utf8)
  }
  func all() throws -> [EarnVaultRecord] {
    guard try store.files.exists(name) else { return [] }
    guard let key = try store.keys.existing() else { throw WalletFailure.unavailable }
    var clear = try WalletEnvelope.decrypt(store.files.read(name), key: key, aad: aad)
    defer { clear.wipe() }
    let root = try JSONDecoder().decode(Contents.self, from: clear)
    try require(root.version == 1 && root.walletId == walletId && root.operations.count <= 256)
    try require(Set(root.operations.map(\.operationId)).count == root.operations.count)
    for op in root.operations {
      try require(
        op.walletId == walletId && op.operationId == op.proposal.operationId && op.revision > 0)
      try require(
        op.steps.count <= 2 && op.steps.enumerated().allSatisfy { $0.offset == $0.element.index })
    }
    return root.operations
  }
  private func write(_ operations: [EarnVaultRecord]) throws {
    var clear = try JSONEncoder().encode(
      Contents(version: 1, walletId: walletId, operations: operations))
    defer { clear.wipe() }
    try require(clear.count <= 3 * 1024 * 1024)
    guard let key = try store.keys.existing() else { throw WalletFailure.unavailable }
    try store.files.write(name, bytes: WalletEnvelope.encrypt(clear, key: key, aad: aad))
  }
  func get(_ id: String) throws -> EarnVaultRecord {
    guard let value = try all().first(where: { $0.operationId == id }) else {
      throw WalletFailure.invalid
    }
    return value
  }
  func create(_ proposal: EarnVaultProposal) throws -> EarnVaultRecord {
    var entries = try all()
    try require(entries.count < 256 && !entries.contains { $0.operationId == proposal.operationId })
    try require(
      !entries.contains {
        $0.blocked && $0.proposal.expectedFrom.lowercased() == proposal.expectedFrom.lowercased()
      })
    let op = EarnVaultRecord(
      operationId: proposal.operationId, walletId: walletId, proposal: proposal)
    entries.append(op)
    try write(entries)
    return op
  }
  @discardableResult func update(
    _ id: String, revision: UInt32, _ change: (inout EarnVaultRecord) throws -> Void
  ) throws -> EarnVaultRecord {
    var entries = try all()
    guard let index = entries.firstIndex(where: { $0.operationId == id }),
      entries[index].revision == revision,
      revision < UInt32.max
    else { throw WalletFailure.invalid }
    try change(&entries[index])
    entries[index].revision += 1
    try write(entries)
    return entries[index]
  }
  func prepare(
    _ id: String, revision: UInt32, calls: [EarnExecutionCall], hash: String, text: String,
    state: EarnExecutionState, proposal: EarnVaultProposal
  ) throws -> EarnVaultRecord {
    try update(id, revision: revision) { op in
      try require(!op.cancelled && op.unresolved.isEmpty)
      let old = op.steps.filter { $0.raw != nil }
      op.steps =
        old + calls.enumerated().map { EarnVaultStep($0.element, index: old.count + $0.offset) }
      try require(!op.steps.isEmpty && op.steps.count <= 2)
      op.reviewHash = hash
      op.review = text
      op.baselineShares = state.shares
      op.signingProposal = proposal
      op.stateBinding = EarnVaultBinding(state)
    }
  }
  func persistSigned(_ id: String, revision: UInt32, index: Int, tx: NativeSignedEarnTransaction)
    throws
  {
    try update(id, revision: revision) { op in
      try require(!op.cancelled && op.unresolved.isEmpty && op.steps.indices.contains(index))
      try require(op.steps[index].status == "planned" && op.steps[index].raw == nil)
      try require(
        op.proposal.expectedFrom.lowercased() == tx.from.lowercased()
          && op.steps[index].nonce == String(tx.nonce) && op.reviewHash == tx.reviewHash)
      op.steps[index].raw = tx.rawTransaction
      op.steps[index].transactionHash = tx.transactionHash
      op.steps[index].status = "unknown"
    }
  }
}
