import CoreFoundation
import Foundation

internal struct PortfolioRequest {
  let method: String
  let params: [Any]
}

internal protocol MainnetPortfolioRPC {
  func calls(_ requests: [PortfolioRequest]) async throws -> [Any]
}

/// Dedicated read-only transport. Never shares or changes the testnet signing endpoint.
internal final class NativeMainnetPortfolioRPC: NSObject, MainnetPortfolioRPC,
  URLSessionTaskDelegate
{
  private let post: ((Data) async throws -> Data)?
  init(post: ((Data) async throws -> Data)? = nil) { self.post = post }

  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }

  private func send(_ body: Data) async throws -> Data {
    var request = URLRequest(url: URL(string: "https://rpc.monad.xyz")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = body
    let configuration = URLSessionConfiguration.ephemeral
    configuration.urlCache = nil
    configuration.httpCookieStorage = nil
    configuration.timeoutIntervalForResource = 20
    let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let (stream, response) = try await session.bytes(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw WalletFailure.unavailable }
    var data = Data()
    for try await byte in stream {
      try Task.checkCancellation()
      guard data.count < 262_144 else { throw WalletFailure.invalid }
      data.append(byte)
    }
    return data
  }

  func calls(_ requests: [PortfolioRequest]) async throws -> [Any] {
    try Task.checkCancellation()
    try require(!requests.isEmpty && requests.count <= 40)
    let body = try JSONSerialization.data(
      withJSONObject: requests.enumerated().map { index, request in
        ["jsonrpc": "2.0", "id": index + 1, "method": request.method, "params": request.params]
      })
    let data: Data
    if let post { data = try await post(body) } else { data = try await send(body) }
    try Task.checkCancellation()
    try require(data.count <= 262_144)
    guard let rows = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
      rows.count == requests.count
    else { throw WalletFailure.invalid }
    var results: [Int: Any] = [:]
    for row in rows {
      guard let number = row["id"] as? NSNumber,
        CFGetTypeID(number) != CFBooleanGetTypeID(),
        number.doubleValue == Double(number.intValue),
        (1...requests.count).contains(number.intValue), results[number.intValue] == nil,
        row["jsonrpc"] as? String == "2.0", row["error"] == nil,
        let result = row["result"], !(result is NSNull)
      else { throw WalletFailure.invalid }
      results[number.intValue] = result
    }
    return try (1...requests.count).map {
      guard let value = results[$0] else { throw WalletFailure.invalid }
      return value
    }
  }
}
