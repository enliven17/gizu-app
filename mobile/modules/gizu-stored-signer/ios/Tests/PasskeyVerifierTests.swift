import CryptoKit
import XCTest

@testable import GizuStoredSignerNative

final class PasskeyVerifierTests: WalletTestCase {
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
}
