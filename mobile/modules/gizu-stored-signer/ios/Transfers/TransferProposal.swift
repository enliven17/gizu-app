import Foundation

internal enum TransferProposal {
  static func normalized(_ request: [String: Any], walletID: String) throws -> [[String: Any]] {
    try require(Set(request.keys) == Set(["walletId", "chainId", "transfers"]))
    try require(request["walletId"] as? String == walletID)
    var proposal = request
    proposal.removeValue(forKey: "walletId")
    proposal["kind"] = "nativeTransfers"
    proposal["chainId"] = try exactInteger(
      proposal["chainId"], range: WalletLimits.chainID...WalletLimits.chainID)
    guard var rows = proposal["transfers"] as? [[String: Any]] else { throw WalletFailure.invalid }
    for index in rows.indices {
      rows[index]["accountIndex"] = try exactInteger(
        rows[index]["accountIndex"], range: WalletLimits.accountIndices)
    }

    proposal["transfers"] = rows
    try validateTransferProposal(proposal: json(proposal))
    return rows
  }

  static func exactInteger(_ value: Any?, range: ClosedRange<Int>) throws -> Int {
    guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
      throw WalletFailure.invalid
    }

    let value = number.doubleValue
    try require(
      value.isFinite && value >= Double(range.lowerBound) && value <= Double(range.upperBound)
        && value.rounded() == value)
    return Int(value)
  }

  static func json(_ object: Any) throws -> String {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    try require(data.count <= WalletLimits.encodedInputBytes)
    guard let text = String(data: data, encoding: .utf8) else { throw WalletFailure.invalid }
    return text
  }
}
