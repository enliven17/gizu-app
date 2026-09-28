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
