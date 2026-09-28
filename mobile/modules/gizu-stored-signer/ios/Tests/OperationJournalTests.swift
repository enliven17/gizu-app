import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

final class OperationJournalTests: WalletTestCase {
  func testJournalBlocksDuplicatesPersistsSignedBytesAndHidesThemFromBridge() throws {
    let store = try storage()
    let wallet = try record(verified: true)
    defer { wallet.close() }
    try store.create(wallet)
    let journal = try StoredOperationJournal(store: store, record: wallet)
    let step = StoredStep(
      index: 0, accountIndex: 0, from: "sender", to: "recipient", valueWei: "100")
    let op = try journal.create([step])
    XCTAssertThrowsError(try journal.create([step]))
    XCTAssertThrowsError(try journal.update(op.operationId, revision: 7) { $0.cancelled = true })
    try journal.update(op.operationId) {
      $0.steps[0].raw = "signed-bytes"
      $0.steps[0].status = .unknown
    }

    let restarted = try StoredOperationJournal(store: store, record: wallet)
    XCTAssertEqual(try restarted.get(op.operationId).steps[0].raw, "signed-bytes")
    let publicData = try JSONSerialization.data(
      withJSONObject: restarted.get(op.operationId).publicValue)
    XCTAssertFalse(String(decoding: publicData, as: UTF8.self).contains("signed-bytes"))
    let cancelled = try restarted.update(op.operationId) { $0.cancelled = true }
    XCTAssertTrue(cancelled.blocked)
    XCTAssertFalse(cancelled.resumable)
    let signed = try restarted.update(op.operationId) { $0.steps[0].status = .signed }
    XCTAssertTrue(signed.resumable)
    let conflict = try restarted.update(op.operationId) { $0.steps[0].conflict = true }
    XCTAssertFalse(conflict.resumable)
  }
}
