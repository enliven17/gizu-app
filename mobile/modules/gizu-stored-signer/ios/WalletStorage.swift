import CryptoKit
import Darwin
import Foundation
import Security

internal protocol WalletKeyStore {
  func existing() throws -> SymmetricKey?
  func create() throws -> SymmetricKey
}
internal struct DeviceWalletKey: WalletKeyStore {
  private let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: "io.gizu.storedwallet.v1",
    kSecAttrAccount as String: "storage-key-v1",
    kSecAttrSynchronizable as String: false,
  ]
  func existing() throws -> SymmetricKey? {
    var request = query
    request[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, var data = result as? Data, data.count == 32 else {
      throw WalletFailure.unavailable
    }
    defer { data.wipe() }
    return SymmetricKey(data: data)
  }
  func create() throws -> SymmetricKey {
    if let key = try existing() { return key }
    var bytes = try randomBytes()
    defer { bytes.wipe() }
    var request = query
    request[kSecValueData as String] = bytes
    request[kSecAttrAccessible as String] = kSecAttrAccessibleWhenPasscodeSetThisDeviceOnly
    try require(SecItemAdd(request as CFDictionary, nil) == errSecSuccess)
    return SymmetricKey(data: bytes)
  }
}
internal protocol WalletFiles {
  func url(_ name: String) throws -> URL
  func exists(_ name: String) throws -> Bool
  func read(_ name: String, limit: Int) throws -> Data
  func write(_ name: String, bytes: Data) throws
}
extension WalletFiles {
  func read(_ name: String) throws -> Data { try read(name, limit: 4 * 1024 * 1024) }
}
internal final class ProtectedFiles: WalletFiles {
  let root: URL
  init(root: URL? = nil) throws {
    self.root =
      try root
      ?? FileManager.default.url(
        for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true
      ).appendingPathComponent("gizu-stored-wallet-v1", isDirectory: true)
    try FileManager.default.createDirectory(
      at: self.root, withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.complete])
    var url = self.root
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try url.setResourceValues(values)
  }
  func url(_ name: String) throws -> URL {
    try require(name.range(of: "^[a-zA-Z0-9.-]+$", options: .regularExpression) != nil)
    return root.appendingPathComponent(name)
  }
  func exists(_ name: String) throws -> Bool {
    FileManager.default.fileExists(atPath: try url(name).path)
  }
  func read(_ name: String, limit: Int = 4 * 1024 * 1024) throws -> Data {
    let path = try url(name)
    let size = try path.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
    try require(size > 0 && size <= limit)
    let bytes = try Data(contentsOf: path)
    try require(bytes.count <= limit)
    return bytes
  }
  func write(_ name: String, bytes: Data) throws {
    try require(!bytes.isEmpty && bytes.count <= 4 * 1024 * 1024)
    let target = try url(name)
    let temporary = root.appendingPathComponent(UUID().uuidString + ".tmp")
    defer { try? FileManager.default.removeItem(at: temporary) }
    try bytes.write(to: temporary, options: [.completeFileProtection, .withoutOverwriting])
    let fd = Darwin.open(temporary.path, O_RDONLY)
    guard fd >= 0 else { throw WalletFailure.invalid }
    let synced = fsync(fd)
    let closed = Darwin.close(fd)
    try require(synced == 0 && closed == 0)
    try require(rename(temporary.path, target.path) == 0)
    let directory = Darwin.open(root.path, O_RDONLY)
    guard directory >= 0 else { throw WalletFailure.invalid }
    let committed = fsync(directory)
    let directoryClosed = Darwin.close(directory)
    try require(committed == 0 && directoryClosed == 0)
    try require(try read(name) == bytes)
  }
}
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
    guard let key = try keys.existing() else { throw WalletFailure.unavailable }
    var clear = try WalletEnvelope.decrypt(
      files.read("wallet.enc", limit: 8192), key: key, aad: aad)
    defer { clear.wipe() }
    // Public metadata is JSON; entropy is a fixed binary suffix, never a JSON string.
    try require(clear.count > 32)
    let metadata = try JSONDecoder().decode(Metadata.self, from: clear.dropLast(32))
    try require(metadata.version == 1)
    return try WalletRecord(
      id: metadata.id, credential: metadata.credential, entropy: Data(clear.suffix(32)),
      verified: metadata.verified, journalId: metadata.journalId)
  }
  func save(_ record: WalletRecord, allowKeyCreation: Bool = false) throws {
    var clear = try JSONEncoder().encode(
      Metadata(
        version: 1, id: record.id, journalId: record.journalId, credential: record.credential,
        verified: record.verified))
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
        && committed.verified == record.verified)
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
      journalId: UUID().uuidString)
    defer { restored.close() }
    try save(restored, allowKeyCreation: true)
  }
  private struct Metadata: Codable {
    let version: Int
    let id: String
    let journalId: String
    let credential: StoredCredential
    let verified: Bool
  }
}
