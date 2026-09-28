import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

private final class FakeRPC: StoredTransferRPC {
  var sent: [String] = []
  func text(_ method: String, _ params: [Any]) async throws -> String {
    if method == "eth_sendRawTransaction" {
      sent.append(params[0] as! String)
      throw WalletFailure.unavailable  // Simulate losing the response after dispatch.
    }
    switch method {
    case "eth_chainId": return "0x279f"
    case "eth_gasPrice", "eth_maxPriorityFeePerGas": return "0x1"
    case "eth_getTransactionCount": return "0x0"
    case "eth_getBalance": return "0x56bc75e2d63100000"  // 100 MON
    case "eth_estimateGas": return "0x5208"
    case "eth_getCode": return "0x"
    default: throw WalletFailure.invalid
    }
  }
  func call(_ method: String, _ params: [Any]) async throws -> Any { NSNull() }
}
private final class FailingFiles: WalletFiles {
  let base: ProtectedFiles
  var failAfterCommit: Bool?
  init(_ root: URL) throws { base = try ProtectedFiles(root: root) }
  func url(_ name: String) throws -> URL { try base.url(name) }
  func exists(_ name: String) throws -> Bool { try base.exists(name) }
  func read(_ name: String, limit: Int) throws -> Data { try base.read(name, limit: limit) }
  func write(_ name: String, bytes: Data) throws {
    if failAfterCommit == false { throw WalletFailure.unavailable }
    try base.write(name, bytes: bytes)
    if failAfterCommit == true { throw WalletFailure.unavailable }
  }
}
final class TransferTests: XCTestCase {
  func testAuthorityExpiresAndNeverRevivesAfterCancel() throws {
    var lifetime = AuthorizationLifetime(now: 100)
    try lifetime.check(now: 219, active: true, protected: true)
    XCTAssertThrowsError(try lifetime.check(now: 220, active: true, protected: true))
    XCTAssertThrowsError(try lifetime.check(now: 101, active: false, protected: true))
    XCTAssertThrowsError(try lifetime.check(now: 101, active: true, protected: false))
    lifetime.cancel()
    XCTAssertThrowsError(try lifetime.check(now: 102, active: true, protected: true))
  }
  @MainActor func testJournalCommitFailureNeverBroadcastsEvenAfterRename() async throws {
    for committed in [false, true] {
      let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
      defer { try? FileManager.default.removeItem(at: root) }
      let files = try FailingFiles(root)
      let store = WalletStorage(files: files, keys: StoredWalletTests.Keys())
      let key = P256.Signing.PrivateKey().publicKey.x963Representation
      let record = try WalletRecord(
        id: UUID().uuidString,
        credential: StoredCredential(id: Data([1]), x: Data(key[1..<33]), y: Data(key[33..<65])),
        entropy: Data(repeating: 0, count: 32), verified: true)
      defer { record.close() }
      try store.create(record)
      let journal = try StoredOperationJournal(store: store, record: record)
      let rpc = FakeRPC()
      let engine = StoredTransferEngine(store: store, journal: journal, rpc: rpc)
      defer { engine.close() }
      let sender = try deriveWalletAddress(entropy: record.entropy)
      let operation = try engine.create([
        "walletId": record.id, "chainId": 10143.0,
        "transfers": [
          [
            "accountIndex": 0.0, "expectedFrom": sender,
            "to": "0x0e4e77B43a94A704E2a7a005238038F3EF00f407", "valueWei": "1000000000000000",
          ]
        ],
      ])
      let review = try await engine.prepare(operation.operationId, revision: operation.revision)
      files.failAfterCommit = committed
      do {
        try await engine.execute(review, authority: {})
        XCTFail("Commit should fail")
      } catch {}
      XCTAssertTrue(rpc.sent.isEmpty)
      files.failAfterCommit = nil
      let recovered = try journal.get(operation.operationId)
      XCTAssertEqual(recovered.steps[0].raw != nil, committed)
      XCTAssertEqual(recovered.steps[0].status, committed ? "unknown" : "planned")
    }
  }
  @MainActor func testUncertainBroadcastPersistsAndResumeUsesIdenticalBytes() async throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let key = P256.Signing.PrivateKey().publicKey.x963Representation
    let record = try WalletRecord(
      id: UUID().uuidString,
      credential: StoredCredential(id: Data([1]), x: Data(key[1..<33]), y: Data(key[33..<65])),
      entropy: Data(repeating: 0, count: 32), verified: true)
    defer { record.close() }
    let store = WalletStorage(files: try ProtectedFiles(root: root), keys: StoredWalletTests.Keys())
    try store.create(record)
    let journal = try StoredOperationJournal(store: store, record: record)
    let rpc = FakeRPC()
    let engine = StoredTransferEngine(store: store, journal: journal, rpc: rpc)
    defer { engine.close() }
    let sender = try deriveWalletAddress(entropy: record.entropy)
    let operation = try engine.create([
      "walletId": record.id, "chainId": 10143,
      "transfers": [
        [
          "accountIndex": 0, "expectedFrom": sender,
          "to": "0x0e4e77B43a94A704E2a7a005238038F3EF00f407", "valueWei": "1000000000000000",
        ]
      ],
    ])
    let review = try await engine.prepare(operation.operationId, revision: operation.revision)
    do {
      try await engine.execute(review, authority: {})
      XCTFail("RPC response should be lost")
    } catch {}
    let uncertain = try journal.get(operation.operationId)
    XCTAssertEqual(uncertain.steps[0].status, "unknown")
    XCTAssertEqual(rpc.sent.count, 1)
    XCTAssertNotNil(uncertain.steps[0].raw)
    try await reconcile(journal, rpc: rpc)
    XCTAssertEqual(rpc.sent.count, 1, "Refresh must not rebroadcast")
    let retryable = try journal.get(operation.operationId)
    XCTAssertTrue(retryable.resumable)
    let resumed = try await engine.prepare(operation.operationId, revision: retryable.revision)
    XCTAssertTrue(resumed.retry)
    do {
      try await engine.execute(resumed, authority: {})
      XCTFail("RPC response should still be lost")
    } catch {}
    XCTAssertEqual(rpc.sent.count, 2)
    XCTAssertEqual(rpc.sent[0], rpc.sent[1])
    do {
      _ = try await engine.prepare(operation.operationId, revision: 1)
      XCTFail("Stale revision accepted")
    } catch {}
  }
}
