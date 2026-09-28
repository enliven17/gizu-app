import CryptoKit
import Foundation

private enum AuthenticatorLayout {
  static let headerBytes = 37
  static let flagsOffset = 32
  static let credentialLengthOffset = 53
  static let credentialOffset = 55
  static let userPresent: UInt8 = 0x01
  static let userVerified: UInt8 = 0x04
  static let backupEligible: UInt8 = 0x08
  static let backupState: UInt8 = 0x10
  static let attestedCredential: UInt8 = 0x40
  static let extensions: UInt8 = 0x80
}

internal enum StoredPasskeyVerifier {
  static let rp = "gizu.io"
  static func client(_ data: Data, type: String, challenge: Data) throws {
    try require(data.count <= WalletLimits.encodedInputBytes)
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let encoded = json["challenge"] as? String
    else { throw WalletFailure.invalid }
    try require(json["type"] as? String == type && json["origin"] as? String == "https://gizu.io")
    if let cross = json["crossOrigin"] { try require((cross as? Bool) == false) }
    try require(Data(urlEncoded: encoded) == challenge)
  }

  static func authenticator(_ data: Data, registration: Bool) throws {
    try require(
      data.count >= AuthenticatorLayout.headerBytes && data.prefix(32) == digest(Data(rp.utf8)))
    let flags = data[AuthenticatorLayout.flagsOffset]
    try require(
      flags & AuthenticatorLayout.userPresent != 0
        && flags & AuthenticatorLayout.userVerified != 0
        && (flags & AuthenticatorLayout.attestedCredential != 0) == registration)
    try require(
      flags & AuthenticatorLayout.backupState == 0
        || flags & AuthenticatorLayout.backupEligible != 0)
  }

  static func registration(id: Data, clientData: Data, attestation: Data, challenge: Data) throws
    -> StoredCredential
  {
    try client(clientData, type: "webauthn.create", challenge: challenge)
    var reader = try CredentialCBORReader(attestation)
    guard let object = try reader.read().map, object["s:fmt"]?.text == "none",
      object["s:attStmt"]?.map?.isEmpty == true,
      let auth = object["s:authData"]?.data
    else { throw WalletFailure.invalid }
    try require(reader.offset == reader.bytes.count)
    try authenticator(auth, registration: true)
    try require(auth.count >= AuthenticatorLayout.credentialOffset)
    let length =
      Int(auth[AuthenticatorLayout.credentialLengthOffset]) * 256
      + Int(auth[AuthenticatorLayout.credentialLengthOffset + 1])
    let credentialStart = AuthenticatorLayout.credentialOffset
    let credentialEnd = credentialStart + length
    try require((1...1024).contains(length))
    try require(auth.count > credentialEnd)
    try require(Data(auth[credentialStart..<credentialEnd]) == id)
    var keyReader = try CredentialCBORReader(Data(auth.dropFirst(credentialEnd)))
    guard let cose = try keyReader.read().map, cose["i:1"]?.integer == 2,
      cose["i:3"]?.integer == -7, cose["i:-1"]?.integer == 1,
      let x = cose["i:-2"]?.data, let y = cose["i:-3"]?.data
    else { throw WalletFailure.invalid }
    if auth[AuthenticatorLayout.flagsOffset] & AuthenticatorLayout.extensions != 0 {
      try require(keyReader.read().map != nil)
    }

    try require(keyReader.offset == keyReader.bytes.count)
    let credential = StoredCredential(id: id, x: x, y: y)
    try credential.validate()
    return credential
  }

  static func assertion(
    id: Data, clientData: Data, auth: Data, signature: Data, credential: StoredCredential,
    challenge: Data
  ) throws {
    try credential.validate()
    try require(
      id == credential.id && auth.count <= WalletLimits.encodedInputBytes && signature.count <= 256)
    try client(clientData, type: "webauthn.get", challenge: challenge)
    try authenticator(auth, registration: false)
    if auth[AuthenticatorLayout.flagsOffset] & AuthenticatorLayout.extensions != 0 {
      var reader = try CredentialCBORReader(Data(auth.dropFirst(AuthenticatorLayout.headerBytes)))
      try require(reader.read().map != nil && reader.offset == reader.bytes.count)
    } else {
      try require(auth.count == AuthenticatorLayout.headerBytes)
    }

    let key = try P256.Signing.PublicKey(
      x963Representation: Data([4]) + credential.x + credential.y)
    try require(
      key.isValidSignature(
        P256.Signing.ECDSASignature(derRepresentation: signature), for: auth + digest(clientData)))
  }
}
