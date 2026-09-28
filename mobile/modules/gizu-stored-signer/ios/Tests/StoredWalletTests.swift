import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

final class StoredWalletTests: XCTestCase {
  private let id = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12"
  private func credential() throws -> StoredCredential {
    let key = try P256.Signing.PrivateKey(
      rawRepresentation: Data(repeating: 0, count: 31) + Data([1]))
    let pub = key.publicKey.x963Representation
    return StoredCredential(id: Data([1, 2, 3]), x: Data(pub[1..<33]), y: Data(pub[33..<65]))
  }
  private func record(verified: Bool = false) throws -> WalletRecord {
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
  private func storage(_ keys: Keys = Keys()) throws -> WalletStorage {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    addTeardownBlock { try? FileManager.default.removeItem(at: root) }
    return WalletStorage(files: try ProtectedFiles(root: root), keys: keys)
  }
  func testRegistrationParsesCoseAndRejectsTrailingOrDuplicateCbor() throws {
    let url = Bundle.module.url(
      forResource: "registration", withExtension: "json", subdirectory: "Fixtures")!
    let fixture = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as! [String: String]
    let attestation = try Data(urlEncoded: fixture["attestation"]!)
    let challenge = Data(repeating: 9, count: 32)
    let client = try JSONSerialization.data(withJSONObject: [
      "type": "webauthn.create", "challenge": challenge.base64URL, "origin": "https://gizu.io",
    ])
    let registered = try StoredPasskeyVerifier.registration(
      id: Data([1, 2, 3]), clientData: client, attestation: attestation, challenge: challenge)
    XCTAssertEqual(registered, try credential())
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.registration(
        id: Data([1]), clientData: client, attestation: attestation, challenge: challenge))
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.registration(
        id: Data([1, 2, 3]), clientData: client, attestation: attestation + Data([0]),
        challenge: challenge))
    var duplicate = try CredentialCBORReader(Data([0xa2, 1, 2, 1, 3]))
    XCTAssertThrowsError(try duplicate.read())
    var truncated = try CredentialCBORReader(Data([0x59, 0xff, 0xff]))
    XCTAssertThrowsError(try truncated.read())
  }
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
  func testVerifiedAssertionsRejectWrongCredentialChallengeOriginAndFlags() throws {
    let privateKey = try P256.Signing.PrivateKey(
      rawRepresentation: Data(repeating: 0, count: 31) + Data([1]))
    let key = try credential()
    let challenge = Data(repeating: 9, count: 32)
    func client(origin: String = "https://gizu.io") throws -> Data {
      try JSONSerialization.data(withJSONObject: [
        "type": "webauthn.get", "challenge": challenge.base64URL, "origin": origin,
      ])
    }
    let data = try client()
    let auth = digest(Data("gizu.io".utf8)) + Data([5, 0, 0, 0, 0])
    let signature = try privateKey.signature(for: auth + digest(data)).derRepresentation
    try StoredPasskeyVerifier.assertion(
      id: key.id, clientData: data, auth: auth, signature: signature, credential: key,
      challenge: challenge)
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.assertion(
        id: Data([8]), clientData: data, auth: auth, signature: signature, credential: key,
        challenge: challenge))
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.assertion(
        id: key.id, clientData: data, auth: auth, signature: signature, credential: key,
        challenge: Data([1])))
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.assertion(
        id: key.id, clientData: client(origin: "https://other.io"), auth: auth,
        signature: signature, credential: key, challenge: challenge))
    var noUV = auth
    noUV[32] = 1
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.assertion(
        id: key.id, clientData: data, auth: noUV, signature: signature, credential: key,
        challenge: challenge))
    XCTAssertThrowsError(
      try StoredPasskeyVerifier.assertion(
        id: key.id, clientData: data, auth: auth, signature: Data([1]), credential: key,
        challenge: challenge))
  }
  func testJournalBlocksDuplicatesPersistsSignedBytesAndHidesThemFromBridge() throws {
    let store = try storage()
    let wallet = try record(verified: true)
    defer { wallet.close() }
    try store.create(wallet)
    let journal = try StoredOperationJournal(store: store, record: wallet)
    let step = StoredStep(
      index: 0, accountIndex: 0, from: "sender", to: "recipient", valueWei: "100")
    let op = try journal.create([step])
    XCTAssertThrowsError(try journal.create([step]))
    XCTAssertThrowsError(try journal.update(op.operationId, revision: 7) { $0.cancelled = true })
    try journal.update(op.operationId) {
      $0.steps[0].raw = "signed-bytes"
      $0.steps[0].status = "unknown"
    }
    let restarted = try StoredOperationJournal(store: store, record: wallet)
    XCTAssertEqual(try restarted.get(op.operationId).steps[0].raw, "signed-bytes")
    let publicData = try JSONSerialization.data(
      withJSONObject: restarted.get(op.operationId).publicValue)
    XCTAssertFalse(String(decoding: publicData, as: UTF8.self).contains("signed-bytes"))
    let cancelled = try restarted.update(op.operationId) { $0.cancelled = true }
    XCTAssertTrue(cancelled.blocked)
    XCTAssertFalse(cancelled.resumable)
    let signed = try restarted.update(op.operationId) { $0.steps[0].status = "signed" }
    XCTAssertTrue(signed.resumable)
    let conflict = try restarted.update(op.operationId) { $0.steps[0].conflict = true }
    XCTAssertFalse(conflict.resumable)
  }
}
