import Foundation

internal enum StoredSwapReconciler {
  static func covering(entropy: Data, backup: String) async -> String {
    var highest = 2
    var gap = 0
    var index = 3
    do {
      while gap < 6 && index < 51 {
        let address = try deriveAccountAddressRange(entropy: entropy, start: UInt32(index), count: 1)
          .first?.dropFirst(2) ?? ""
        let data = "0x70a08231" + String(repeating: "0", count: 24) + address.lowercased()
        let body: [String: Any] = [
          "jsonrpc": "2.0", "id": 1, "method": "eth_call",
          "params": [["to": "0x5fc5360d0400a0fd4f2af552add042d716f1d168", "data": data], "latest"],
        ]
        let response = try await post(body)
        let hex = (response["result"] as? String ?? "0x").dropFirst(2).drop { $0 == "0" }
        if !hex.isEmpty {
          highest = index
          gap = 0
        } else {
          gap += 1
        }
        index += 1
      }
      let scanned: String
      if highest < 3 {
        scanned = roleRegistryInitial()
      } else {
        scanned = try roleRegistryCovering(highestUsed: UInt32(highest))
      }
      return try mergeRoleRegistries(local: backup, other: scanned)
    } catch {
      return backup
    }
  }

  private static func post(_ body: [String: Any]) async throws -> [String: Any] {
    var request = URLRequest(url: URL(string: "https://rpc.mainnet.chain.robinhood.com")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 20
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, response) = try await URLSession.shared.data(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200,
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw WalletFailure.invalid }
    return object
  }
}
