import Foundation

// Exact bounded decimal arithmetic. Reject oversized RPC values rather than rounding.
internal func quantity(_ hex: String) throws -> Decimal {
  try require(
    hex.range(of: "^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,30})$", options: .regularExpression) != nil)
  return hex.dropFirst(2).reduce(Decimal.zero) { $0 * 16 + Decimal(Int(String($1), radix: 16)!) }
}

internal func decimalValue(_ value: String) throws -> Decimal {
  try require(value.range(of: "^(0|[1-9][0-9]{0,36})$", options: .regularExpression) != nil)
  guard let number = Decimal(string: value, locale: Locale(identifier: "en_US_POSIX")) else {
    throw WalletFailure.invalid
  }

  return number
}

internal func decimalText(_ number: Decimal) -> String {
  NSDecimalNumber(decimal: number).stringValue
}

internal func rpcText(_ object: [String: Any], _ key: String) throws -> String {
  guard let text = object[key] as? String else { throw WalletFailure.invalid }
  return text
}
