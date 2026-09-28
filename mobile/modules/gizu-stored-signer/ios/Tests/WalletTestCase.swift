import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

class WalletTestCase: XCTestCase {
  let id = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  func credential() throws -> StoredCredential {
    let key = try P256.Signing.PrivateKey(
      rawRepresentation: Data(repeating: 0, count: 31) + Data([1]))
    let pub = key.publicKey.x963Representation
    return StoredCredential(id: Data([1, 2, 3]), x: Data(pub[1..<33]), y: Data(pub[33..<65]))
  }

  func record(verified: Bool = false) throws -> WalletRecord {
    try WalletRecord(
      id: id, credential: credential(), entropy: Data(repeating: 0, count: 32), verified: verified)
  }

  final class Keys: WalletKeyStore {
    var key: SymmetricKey? = SymmetricKey(size: .bits256)
    func existing() throws -> SymmetricKey? { key }
    func create() throws -> SymmetricKey {
      if key == nil { key = SymmetricKey(size: .bits256) }
      return key!
    }
  }
  func storage(_ keys: Keys = Keys()) throws -> WalletStorage {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    return WalletStorage(files: try ProtectedFiles(root: root), keys: keys)
  }
}
