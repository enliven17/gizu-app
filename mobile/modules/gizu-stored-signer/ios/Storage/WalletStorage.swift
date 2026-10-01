import CryptoKit
import Foundation

internal final class WalletStorage {
  let files: WalletFiles
  let keys: WalletKeyStore
  private let aad = Data("io.gizu.storedwallet.v1:wallet:gizu.io:gizu-stored-evm-v1".utf8)
  init(files: WalletFiles, keys: WalletKeyStore = DeviceWalletKey()) {
    self.files = files
    self.keys = keys
  }

  func exists() throws -> Bool { try files.exists("wallet.enc") }
  func state() -> String {
    do {
      if try !exists() { return "absent" }
      let record = try load()
      defer { record.close() }
      return record.verified ? "ready" : "backupRequired"
    } catch { return "recoveryRequired" }
  }

  func load() throws -> WalletRecord {
    guard let key = try keys.existing() else { throw WalletFailure.recoveryRequired }
    var clear = try WalletEnvelope.decrypt(
      files.read("wallet.enc", limit: WalletLimits.walletRecordBytes), key: key, aad: aad)
    defer { clear.wipe() }
    // Public metadata is JSON; entropy is a fixed binary suffix, never a JSON string.
    try require(clear.count > 32)
    let metadata = try JSONDecoder().decode(Metadata.self, from: clear.dropLast(32))
    try require(metadata.version == 1 || metadata.version == 2)
    return try WalletRecord(
      id: metadata.id, credential: metadata.credential, entropy: Data(clear.suffix(32)),
      verified: metadata.verified, journalId: metadata.journalId,
      roleRegistry: metadata.roleRegistry)
  }

  func save(_ record: WalletRecord, allowKeyCreation: Bool = false) throws {
    var clear = try JSONEncoder().encode(
      Metadata(
        version: 2, id: record.id, journalId: record.journalId, credential: record.credential,
        verified: record.verified, roleRegistry: record.roleRegistry))
    clear.append(record.entropy)
    defer { clear.wipe() }
    let key: SymmetricKey
    if let existing = try keys.existing() {
      key = existing
    } else if allowKeyCreation {
      key = try keys.create()
    } else {
      throw WalletFailure.unavailable
    }

    try files.write("wallet.enc", bytes: WalletEnvelope.encrypt(clear, key: key, aad: aad))
    let committed = try load()
    defer { committed.close() }
    try require(
      committed.id == record.id && committed.entropy == record.entropy
        && committed.verified == record.verified && committed.roleRegistry == record.roleRegistry)
  }

  func create(_ record: WalletRecord) throws {
    try require(!exists())
    try save(record, allowKeyCreation: true)
  }

  func restore(_ record: WalletRecord) throws {
    try require(["absent", "recoveryRequired"].contains(state()))
    // Reuse an accessible storage key, or create one if lost. Never replace a healthy wallet.
    let restored = try WalletRecord(
      id: record.id, credential: record.credential, entropy: record.entropy, verified: true,
      journalId: UUID().uuidString, roleRegistry: record.roleRegistry)
    defer { restored.close() }
    try save(restored, allowKeyCreation: true)
  }

  func persistRegistry(_ registry: String, expectedId: String) throws {
    try requireRoleRegistry(registry)
    let current = try load()
    defer { current.close() }
    try require(current.id == expectedId)
    let next = try registryNext(registry)
    try require(next >= registryNext(current.roleRegistry))
    let updated = try WalletRecord(
      id: current.id, credential: current.credential, entropy: Data(current.entropy),
      verified: current.verified, journalId: current.journalId, roleRegistry: registry)
    defer { updated.close() }
    try save(updated)
  }

  private struct Metadata: Codable {
    let version: Int
    let id: String
    let journalId: String
    let credential: StoredCredential
    let verified: Bool
    let roleRegistry: String

    init(
      version: Int, id: String, journalId: String, credential: StoredCredential, verified: Bool,
      roleRegistry: String
    ) {
      self.version = version
      self.id = id
      self.journalId = journalId
      self.credential = credential
      self.verified = verified
      self.roleRegistry = roleRegistry
    }

    private enum CodingKeys: String, CodingKey {
      case version, id, journalId, credential, verified, roleRegistry
    }

    func encode(to encoder: Encoder) throws {
      var values = encoder.container(keyedBy: CodingKeys.self)
      try values.encode(version, forKey: .version)
      try values.encode(id, forKey: .id)
      try values.encode(journalId, forKey: .journalId)
      try values.encode(credential, forKey: .credential)
      try values.encode(verified, forKey: .verified)
      try values.encode(roleRegistry, forKey: .roleRegistry)
    }

    init(from decoder: Decoder) throws {
      let values = try decoder.container(keyedBy: CodingKeys.self)
      version = try values.decode(Int.self, forKey: .version)
      id = try values.decode(String.self, forKey: .id)
      journalId = try values.decode(String.self, forKey: .journalId)
      credential = try values.decode(StoredCredential.self, forKey: .credential)
      verified = try values.decode(Bool.self, forKey: .verified)
      roleRegistry =
        try values.decodeIfPresent(String.self, forKey: .roleRegistry)
        ?? #"{"version":1,"nextRecipient":3}"#
    }
  }
}
