import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

final class BackupTests: WalletTestCase {
  func testSharedBackupFixtureAndDerivation() throws {
    let url = Bundle.module.url(
      forResource: "android-compatible-backup", withExtension: "json", subdirectory: "Fixtures")!
    let fixture = try Data(contentsOf: url)
    let restored = try StoredBackupCodec.decrypt(fixture, prf: Data(repeating: 7, count: 32))
    defer { restored.close() }
    XCTAssertEqual(restored.id, id)
    XCTAssertEqual(restored.entropy, Data(repeating: 0, count: 32))
    let addresses = try deriveAccountAddresses(entropy: restored.entropy)
    XCTAssertEqual(addresses.count, 16)
    XCTAssertEqual(addresses[0], "0xF278cF59F82eDcf871d630F28EcC8056f25C1cdb")
    XCTAssertEqual(Set(addresses).count, 16)
    XCTAssertThrowsError(try StoredBackupCodec.decrypt(fixture, prf: Data(repeating: 8, count: 32)))
    var header = try JSONSerialization.jsonObject(with: fixture) as! [String: Any]
    header["walletId"] = UUID().uuidString
    XCTAssertThrowsError(
      try StoredBackupCodec.decrypt(
        JSONSerialization.data(withJSONObject: header), prf: Data(repeating: 7, count: 32)))
    header["version"] = 2
    XCTAssertThrowsError(
      try StoredBackupCodec.credential(JSONSerialization.data(withJSONObject: header)))
    XCTAssertThrowsError(try StoredBackupCodec.credential(Data(repeating: 1, count: 65537)))
  }

  func testEncryptedV3FixtureRestoresCatalogueAndDoesNotExposeItInHeader() throws {
    let url = Bundle.module.url(
      forResource: "android-compatible-backup-v3", withExtension: "json", subdirectory: "Fixtures")!
    let fixture = try Data(contentsOf: url)
    let restored = try StoredBackupCodec.decrypt(fixture, prf: Data(repeating: 7, count: 32))
    defer { restored.close() }
    XCTAssertEqual(restored.entropy, Data(repeating: 0, count: 32))
    XCTAssertEqual(try registryNext(restored.roleRegistry), 7)
    XCTAssertEqual(restored.earnChain, 1)
    XCTAssertEqual(restored.earnCycleIndex, 2)
    XCTAssertFalse(restored.earnRecoveryRequired)
    let cycles = try JSONSerialization.jsonObject(with: Data(restored.earnCycles.utf8)) as! [[String: Any]]
    XCTAssertEqual(cycles.count, 2)
    XCTAssertEqual(cycles[0]["withdrawalIndex"] as? Int, 3)
    XCTAssertEqual(cycles[1]["withdrawalIndex"] as? Int, 6)
    let encrypted = try StoredBackupCodec.encrypt(restored, prf: Data(repeating: 7, count: 32))
    let header = try JSONSerialization.jsonObject(with: encrypted) as! [String: Any]
    XCTAssertEqual(header["version"] as? Int, 3)
    for field in ["entropy", "roleRegistry", "earnChain", "earnRecoveryRequired", "earnCycleIndex", "earnCycles"] {
      XCTAssertNil(header[field])
    }
    let copy = try StoredBackupCodec.decrypt(encrypted, prf: Data(repeating: 7, count: 32))
    defer { copy.close() }
    XCTAssertEqual(copy.roleRegistry, restored.roleRegistry)
    XCTAssertEqual(copy.earnCycles, restored.earnCycles)
    XCTAssertEqual(copy.earnCycleIndex, restored.earnCycleIndex)
    XCTAssertThrowsError(try StoredBackupCodec.decrypt(fixture, prf: Data(repeating: 8, count: 32)))
  }

  func testV2BackupRetainsAuthenticatedRegistryAndDefaultsEarnMetadata() throws {
    let wallet = try record()
    defer { wallet.close() }
    let registry = #"{"version":1,"nextRecipient":8}"#
    var header: [String: Any] = [
      "format": "gizu-stored-wallet", "version": 2, "rpId": "gizu.io",
      "derivationVersion": "gizu-stored-evm-v1", "walletId": wallet.id,
      "credentialId": wallet.credential.id.base64URL, "x": wallet.credential.x.base64URL,
      "y": wallet.credential.y.base64URL, "roleRegistry": registry,
    ]
    let aad = Data((["gizu-stored-wallet", "2", "gizu.io", "gizu-stored-evm-v1", wallet.id,
      wallet.credential.id.base64URL, wallet.credential.x.base64URL,
      wallet.credential.y.base64URL, registry].joined(separator: ":")).utf8)
    header["envelope"] = try WalletEnvelope.encrypt(wallet.entropy,
      key: SymmetricKey(data: Data(repeating: 7, count: 32)), aad: aad).base64URL
    let restored = try StoredBackupCodec.decrypt(JSONSerialization.data(withJSONObject: header),
      prf: Data(repeating: 7, count: 32))
    defer { restored.close() }
    XCTAssertEqual(restored.roleRegistry, registry)
    XCTAssertEqual(restored.earnCycleIndex, 0)
    XCTAssertEqual(restored.earnCycles, "[]")
    header["roleRegistry"] = #"{"version":1,"nextRecipient":9}"#
    XCTAssertThrowsError(try StoredBackupCodec.decrypt(JSONSerialization.data(withJSONObject: header),
      prf: Data(repeating: 7, count: 32)))
  }

  func testBackupRoundTripAndEnvelopeAuthentication() throws {
    let wallet = try record()
    defer { wallet.close() }
    let prf = Data(repeating: 7, count: 32)
    let bytes = try StoredBackupCodec.encrypt(wallet, prf: prf)
    let restored = try StoredBackupCodec.decrypt(bytes, prf: prf)
    defer { restored.close() }
    XCTAssertEqual(restored.credential, wallet.credential)
    XCTAssertEqual(restored.entropy, wallet.entropy)
    XCTAssertNotEqual(bytes, try StoredBackupCodec.encrypt(wallet, prf: prf))
    let key = SymmetricKey(data: prf)
    let aad = Data([1])
    var sealed = try WalletEnvelope.encrypt(wallet.entropy, key: key, aad: aad)
    XCTAssertThrowsError(try WalletEnvelope.decrypt(sealed, key: key, aad: Data([2])))
    sealed[sealed.count - 1] ^= 1
    XCTAssertThrowsError(try WalletEnvelope.decrypt(sealed, key: key, aad: aad))
  }
}
