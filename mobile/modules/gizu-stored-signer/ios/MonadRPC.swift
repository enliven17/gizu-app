import Foundation

internal protocol StoredTransferRPC {
  func call(_ method: String, _ params: [Any]) async throws -> Any
  func text(_ method: String, _ params: [Any]) async throws -> String
}
internal final class StoredMonadRPC: NSObject, URLSessionTaskDelegate, StoredTransferRPC {
  func urlSession(
    _ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) { completionHandler(nil) }
  func call(_ method: String, _ params: [Any] = []) async throws -> Any {
    var request = URLRequest(url: URL(string: "https://testnet-rpc.monad.xyz")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 15
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONSerialization.data(withJSONObject: [
      "jsonrpc": "2.0", "id": 1, "method": method, "params": params,
    ])
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.httpCookieStorage = nil
    let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    let (stream, response) = try await session.bytes(for: request)
    guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw WalletFailure.invalid }
    var data = Data()
    for try await byte in stream {
      guard data.count < 1_048_576 else { throw WalletFailure.invalid }
      data.append(byte)
    }
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      object["error"] == nil, object["id"] as? Int == 1, object["jsonrpc"] as? String == "2.0",
      let result = object["result"]
    else { throw WalletFailure.invalid }
    return result
  }
  func text(_ method: String, _ params: [Any] = []) async throws -> String {
    guard let result = try await call(method, params) as? String else {
      throw WalletFailure.invalid
    }
    return result
  }
}
