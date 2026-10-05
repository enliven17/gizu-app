import CoreFoundation
import Foundation

internal enum EarnValues {
  static let vault = "0x55C1B6e461a6334B567bAF0FEb5D728715446f05"
  static let usdc = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
  static let router = "0x02912516d49dE997db75B9D7858faAE59209650B"
  static func addressWord(_ value: String) throws -> String {
    try require(value.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil)
    return String(repeating: "0", count: 24) + value.dropFirst(2).lowercased()
  }
  static func hash(_ value: String) throws -> String {
    try require(value.range(of: "^0x[0-9a-fA-F]{64}$", options: .regularExpression) != nil)
    return value.lowercased()
  }
  static func object(_ value: Any) throws -> [String: Any] {
    guard let result = value as? [String: Any] else { throw WalletFailure.invalid }
    return result
  }
  static func json<T: Encodable>(_ value: T) throws -> String {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return String(decoding: try encoder.encode(value), as: UTF8.self)
  }
  static func atLeast(_ a: String, _ b: String) throws -> Bool {
    _ = try earnAmountWord(value: a)
    _ = try earnAmountWord(value: b)
    return a.count != b.count ? a.count > b.count : a >= b
  }
  static func uint(_ value: String) throws -> UInt64 {
    guard let number = UInt64(try earnQuantityValue(value: value)) else {
      throw WalletFailure.invalid
    }
    return number
  }
  static func exactInteger(_ value: Any) throws -> UInt64 {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID(),
      n.doubleValue >= 0, n.doubleValue <= 9_007_199_254_740_991,
      n.doubleValue == Double(n.uint64Value)
    else { throw WalletFailure.invalid }
    return n.uint64Value
  }
  static func pinned(_ hash: String) throws -> [String: Any] {
    ["blockHash": try Self.hash(hash), "requireCanonical": true]
  }
}
