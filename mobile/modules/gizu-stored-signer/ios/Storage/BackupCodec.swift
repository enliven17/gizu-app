import CryptoKit
import Foundation

internal enum StoredBackupCodec {
  private static func header(_ bytes: Data) throws -> [String: Any] {
    try require(!bytes.isEmpty && bytes.count <= WalletLimits.backupBytes)
    guard let h = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else {
      throw WalletFailure.invalid
    }

    guard let version = h["version"] as? NSNumber, CFGetTypeID(version) != CFBooleanGetTypeID(),
      ["1", "2", "3"].contains(version.stringValue)
    else { throw WalletFailure.invalid }
    try require(
      h["format"] as? String == "gizu-stored-wallet"
        && [1, 2, 3].contains(h["version"] as? Int ?? 0)
        && h["rpId"] as? String == "gizu.io"
        && h["derivationVersion"] as? String == "gizu-stored-evm-v1")
    if version.intValue == 2 { try requireRoleRegistry(try text(h, "roleRegistry")) }
    else { try require(h["roleRegistry"] == nil) }
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
    guard let versionNumber = h["version"] as? Int else { throw WalletFailure.invalid }
    var parts = try ["gizu-stored-wallet", String(versionNumber), "gizu.io", "gizu-stored-evm-v1"]
      + ["walletId", "credentialId", "x", "y"].map { try text(h, $0) }
    if versionNumber == 2 { parts.append(try text(h, "roleRegistry")) }
    return Data(parts.joined(separator: ":").utf8)
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
      "format": "gizu-stored-wallet", "version": 3, "rpId": "gizu.io",
      "derivationVersion": "gizu-stored-evm-v1", "walletId": record.id,
      "credentialId": record.credential.id.base64URL, "x": record.credential.x.base64URL,
      "y": record.credential.y.base64URL,
    ]
    var clear = try JSONSerialization.data(withJSONObject: [
      "version": 3, "entropy": record.entropy.base64URL, "roleRegistry": record.roleRegistry,
      "earnChain": record.earnChain, "earnRecoveryRequired": record.earnRecoveryRequired,
      "earnCycleIndex": record.earnCycleIndex, "earnCycles": record.earnCycles,
    ], options: [.sortedKeys])
    defer { clear.wipe() }
    h["envelope"] = try WalletEnvelope.encrypt(
      clear, key: SymmetricKey(data: prf), aad: aad(h)
    ).base64URL
    let bytes = try JSONSerialization.data(withJSONObject: h, options: [.sortedKeys])
    try require(bytes.count <= WalletLimits.backupBytes)
    return bytes
  }

  private static func integer(_ object: [String: Any], _ key: String) throws -> Int {
    guard let value = object[key] as? NSNumber,
      CFGetTypeID(value) != CFBooleanGetTypeID(),
      let integer = Int(value.stringValue)
    else { throw WalletFailure.invalid }
    return integer
  }

  static func decrypt(_ bytes: Data, prf: Data) throws -> WalletRecord {
    try require(prf.count == 32)
    let h = try header(bytes)
    var clear = try WalletEnvelope.decrypt(
      Data(urlEncoded: text(h, "envelope")), key: SymmetricKey(data: prf), aad: aad(h))
    defer { clear.wipe() }
    if h["version"] as? Int == 3 {
      guard let payload = try JSONSerialization.jsonObject(with: clear) as? [String: Any],
        Set(payload.keys) == Set(["version", "entropy", "roleRegistry", "earnChain", "earnRecoveryRequired", "earnCycleIndex", "earnCycles"]),
        let recovery = payload["earnRecoveryRequired"] as? NSNumber,
        CFGetTypeID(recovery) == CFBooleanGetTypeID()
      else { throw WalletFailure.invalid }
      try require(try integer(payload, "version") == 3)
      var entropy = try Data(urlEncoded: text(payload, "entropy"))
      defer { entropy.wipe() }
      return try WalletRecord(
        id: text(h, "walletId"), credential: credential(bytes), entropy: entropy,
        roleRegistry: text(payload, "roleRegistry"), earnChain: integer(payload, "earnChain"),
        earnRecoveryRequired: recovery.boolValue, earnCycleIndex: integer(payload, "earnCycleIndex"),
        earnCycles: text(payload, "earnCycles"))
    }
    return try WalletRecord(
      id: text(h, "walletId"), credential: credential(bytes), entropy: clear,
      roleRegistry: h["version"] as? Int == 2 ? text(h, "roleRegistry") : #"{"version":1,"nextRecipient":3}"#)
  }
}
