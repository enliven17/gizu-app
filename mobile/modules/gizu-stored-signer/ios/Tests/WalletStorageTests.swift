import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

final class WalletStorageTests: WalletTestCase {
  func testStorageDoesNotOverwriteAndMissingKeyRequiresRecovery() throws {
    let keys = Keys()
    let store = try storage(keys)
    let wallet = try record()
    defer { wallet.close() }
    XCTAssertEqual(store.state(), "absent")
    try store.create(wallet)
    XCTAssertEqual(store.state(), "backupRequired")
    XCTAssertThrowsError(try store.create(wallet))
    wallet.verified = true
    try store.save(wallet)
    XCTAssertEqual(store.state(), "ready")
    XCTAssertThrowsError(try store.restore(wallet))
    keys.key = nil
    XCTAssertThrowsError(try store.load()) {
      XCTAssertEqual(WalletErrors.code($0), "RECOVERY_REQUIRED")
    }
    XCTAssertEqual(store.state(), "recoveryRequired")
    XCTAssertThrowsError(try store.create(wallet))
    XCTAssertNil(keys.key)
    try store.restore(wallet)
    let restored = try store.load()
    defer { restored.close() }
    XCTAssertEqual(restored.entropy, wallet.entropy)
    XCTAssertNotEqual(restored.journalId, wallet.journalId)
  }

  func testCorruptionAndFailedFileCommitPreserveRecoveryState() throws {
    let store = try storage()
    let wallet = try record()
    defer { wallet.close() }
    try store.create(wallet)
    try store.files.write("wallet.enc", bytes: Data([1, 2, 3]))
    XCTAssertEqual(store.state(), "recoveryRequired")
    XCTAssertThrowsError(try store.create(wallet))
    XCTAssertThrowsError(try store.files.write("../escape", bytes: Data([1])))
    XCTAssertThrowsError(
      try store.files.write("wallet.enc", bytes: Data(repeating: 0, count: 4 * 1024 * 1024 + 1)))
    XCTAssertEqual(try store.files.read("wallet.enc"), Data([1, 2, 3]))
  }
}
