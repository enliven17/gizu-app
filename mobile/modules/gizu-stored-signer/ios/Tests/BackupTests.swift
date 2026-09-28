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
