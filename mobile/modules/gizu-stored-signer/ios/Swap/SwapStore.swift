import Foundation

internal final class StoredSwapFile {
  let walletId: String
  private let files: WalletFiles
  private let keys: WalletKeyStore
  private let name: String
  private let aad: Data

  init(store: WalletStorage, record: WalletRecord) {
    walletId = record.id
    files = store.files
    keys = store.keys
    name = "gizu-swap-\(record.journalId).enc"
    aad = Data("gizu-swap:v1:\(record.id):\(record.journalId)".utf8)
  }

  func load() throws -> [String: Any]? {
    guard try files.exists(name) else { return nil }
    guard let key = try keys.existing() else { throw WalletFailure.unavailable }
    var clear = try WalletEnvelope.decrypt(files.read(name, limit: 1_048_576), key: key, aad: aad)
    defer { clear.wipe() }
    guard let root = try JSONSerialization.jsonObject(with: clear) as? [String: Any],
      root["version"] as? Int == 1, root["walletId"] as? String == walletId,
      let state = root["state"] as? String, state.count <= 900_000
    else { throw WalletFailure.invalid }
    return root
  }

  func save(operationId: String, state: String, fundingAddress: String) throws {
    try require(state.count <= 900_000 && fundingAddress.hasPrefix("0x"))
    let root: [String: Any] = [
      "version": 1, "walletId": walletId, "operationId": operationId,
      "fundingAddress": fundingAddress, "state": state,
    ]
    var clear = try JSONSerialization.data(withJSONObject: root)
    defer { clear.wipe() }
    guard let key = try keys.existing() else { throw WalletFailure.unavailable }
    try files.write(name, bytes: WalletEnvelope.encrypt(clear, key: key, aad: aad))
  }
}
