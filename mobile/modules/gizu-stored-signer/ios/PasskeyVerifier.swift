import CryptoKit
import Foundation

// Bounded, definite-length CBOR subset used by WebAuthn attestation/COSE.
internal indirect enum CredentialCBOR {
  case integer(Int)
  case bytes(Data)
  case text(String)
  case map([String: CredentialCBOR])
  case array([CredentialCBOR])
  case simple(UInt8)
  var data: Data? {
    if case .bytes(let value) = self { return value }
    return nil
  }
  var integer: Int? {
    if case .integer(let value) = self { return value }
    return nil
  }
  var text: String? {
    if case .text(let value) = self { return value }
    return nil
  }
  var map: [String: CredentialCBOR]? {
    if case .map(let value) = self { return value }
    return nil
  }
}
internal struct CredentialCBORReader {
  let bytes: [UInt8]
  var offset = 0
  init(_ data: Data) throws {
    try require(data.count <= 65536)
    bytes = Array(data)
  }
  mutating func read(_ depth: Int = 0) throws -> CredentialCBOR {
    try require(depth < 16 && offset < bytes.count)
    let head = bytes[offset]
    offset += 1
    let major = head >> 5
    let info = head & 31
    if major == 7 {
      try require([20, 21, 22].contains(info))
      return .simple(info)
    }
    var count = Int(info)
    if info >= 24 {
      try require(info <= 27)
      let length = 1 << Int(info - 24)
      try require(offset + length <= bytes.count)
      count = 0
      for _ in 0..<length {
        try require(count <= (Int.max - 255) / 256)
        count = count * 256 + Int(bytes[offset])
        offset += 1
      }
    }
    switch major {
    case 0: return .integer(count)
    case 1:
      try require(count < Int.max)
      return .integer(-1 - count)
    case 2, 3:
      try require(count <= bytes.count - offset)
      let value = Data(bytes[offset..<(offset + count)])
      offset += count
      if major == 2 { return .bytes(value) }
      guard let text = String(data: value, encoding: .utf8) else { throw WalletFailure.invalid }
      return .text(text)
    case 4:
      try require(count <= 1024)
      var result: [CredentialCBOR] = []
      for _ in 0..<count { result.append(try read(depth + 1)) }
      return .array(result)
    case 5:
      try require(count <= 128)
      var result: [String: CredentialCBOR] = [:]
      for _ in 0..<count {
        let key = try read(depth + 1)
        let name: String
        switch key {
        case .text(let value): name = "s:" + value
        case .integer(let value): name = "i:\(value)"
        default: throw WalletFailure.invalid
        }
        try require(result[name] == nil)
        result[name] = try read(depth + 1)
      }
      return .map(result)
    default: throw WalletFailure.invalid
    }
  }
}
internal enum StoredPasskeyVerifier {
  static let rp = "gizu.io"
  static func client(_ data: Data, type: String, challenge: Data) throws {
    try require(data.count <= 65536)
    guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let encoded = json["challenge"] as? String
    else { throw WalletFailure.invalid }
    try require(json["type"] as? String == type && json["origin"] as? String == "https://gizu.io")
    if let cross = json["crossOrigin"] { try require((cross as? Bool) == false) }
    try require(Data(urlEncoded: encoded) == challenge)
  }
  static func authenticator(_ data: Data, registration: Bool) throws {
    try require(data.count >= 37 && data.prefix(32) == digest(Data(rp.utf8)))
    let flags = data[32]
    try require(flags & 1 != 0 && flags & 4 != 0 && (flags & 64 != 0) == registration)
    try require(flags & 16 == 0 || flags & 8 != 0)
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
    try require(auth.count >= 55)
    let length = Int(auth[53]) * 256 + Int(auth[54])
    try require(
      (1...1024).contains(length) && auth.count > 55 + length
        && Data(auth[55..<(55 + length)]) == id)
    var keyReader = try CredentialCBORReader(Data(auth.dropFirst(55 + length)))
    guard let cose = try keyReader.read().map, cose["i:1"]?.integer == 2,
      cose["i:3"]?.integer == -7, cose["i:-1"]?.integer == 1,
      let x = cose["i:-2"]?.data, let y = cose["i:-3"]?.data
    else { throw WalletFailure.invalid }
    if auth[32] & 128 != 0 { try require(keyReader.read().map != nil) }
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
    try require(id == credential.id && auth.count <= 65536 && signature.count <= 256)
    try client(clientData, type: "webauthn.get", challenge: challenge)
    try authenticator(auth, registration: false)
    if auth[32] & 128 != 0 {
      var reader = try CredentialCBORReader(Data(auth.dropFirst(37)))
      try require(reader.read().map != nil && reader.offset == reader.bytes.count)
    } else {
      try require(auth.count == 37)
    }
    let key = try P256.Signing.PublicKey(
      x963Representation: Data([4]) + credential.x + credential.y)
    try require(
      key.isValidSignature(
        P256.Signing.ECDSASignature(derRepresentation: signature), for: auth + digest(clientData)))
  }
}
