import CryptoKit
import Foundation

internal enum StoredBackupCodec {
  private static func header(_ bytes: Data) throws -> [String: Any] {
    try require(!bytes.isEmpty && bytes.count <= 65536)
    guard let h = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
      throw WalletFailure.invalid
    }
    guard let version = h["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
      version.stringValue == "1"
    else { throw WalletFailure.invalid }
    try require(
      h["format"] as? String == "gizu-stored-wallet" && h["version"] as? Int == 1
        && h["rpId"] as? String == "gizu.io"
        && h["derivationVersion"] as? String == "gizu-stored-evm-v1")
    guard let id = h["walletId"] as? String, UUID(uuidString: id) != nil else {
      throw WalletFailure.invalid
    }
    return h
  }
  private static func text(_ h: [String: Any], _ key: String) throws -> String {
    guard let value = h[key] as? String else { throw WalletFailure.invalid }
    return value
  }
  private static func aad(_ h: [String: Any]) throws -> Data {
    try Data(
      (["gizu-stored-wallet", "1", "gizu.io", "gizu-stored-evm-v1"]
        + ["walletId", "credentialId", "x", "y"].map { try text(h, $0) }).joined(separator: ":")
        .utf8)
  }
  static func credential(_ bytes: Data) throws -> StoredCredential {
    let h = try header(bytes)
    let key = try StoredCredential(
      id: Data(urlEncoded: text(h, "credentialId")), x: Data(urlEncoded: text(h, "x")),
      y: Data(urlEncoded: text(h, "y")))
    try key.validate()
    return key
  }
  static func encrypt(_ record: WalletRecord, prf: Data) throws -> Data {
    try require(prf.count == 32)
    var h: [String: Any] = [
      "format": "gizu-stored-wallet", "version": 1, "rpId": "gizu.io",
      "derivationVersion": "gizu-stored-evm-v1", "walletId": record.id,
      "credentialId": record.credential.id.base64URL, "x": record.credential.x.base64URL,
      "y": record.credential.y.base64URL,
    ]
    h["envelope"] = try WalletEnvelope.encrypt(
      record.entropy, key: SymmetricKey(data: prf), aad: aad(h)
    ).base64URL
    return try JSONSerialization.data(withJSONObject: h, options: [.sortedKeys])
  }
  static func decrypt(_ bytes: Data, prf: Data) throws -> WalletRecord {
    try require(prf.count == 32)
    let h = try header(bytes)
    var entropy = try WalletEnvelope.decrypt(
      Data(urlEncoded: text(h, "envelope")), key: SymmetricKey(data: prf), aad: aad(h))
    defer { entropy.wipe() }
    return try WalletRecord(
      id: text(h, "walletId"), credential: credential(bytes), entropy: entropy)
  }
}
