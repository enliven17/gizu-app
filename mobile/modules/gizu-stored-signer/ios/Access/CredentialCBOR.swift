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
    try require(data.count <= WalletLimits.encodedInputBytes)
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
