import Foundation

internal enum StoredSwapUi {
  case review(String)
  case unlock
  case done([String: Any])
}

internal final class StoredSwapEngine {
  private let storage: WalletStorage
  private let saved: StoredSwapFile
  private let gateway: String
  private var operation: SwapOperation?
  private var fundingAddress: String?

  init(storage: WalletStorage, saved: StoredSwapFile, gateway: String) {
    self.storage = storage
    self.saved = saved
    self.gateway = gateway
  }

  func start(record: WalletRecord, target: String, amountAtoms: String?) throws {
    try require(record.verified && record.id == saved.walletId && operation == nil)
    if let existing = try saved.load(), let state = existing["state"] as? String {
      let previous = try SwapOperation.restore(state: state, gateway: gateway)
      let phase = try statusObject(previous.publicStatus())["phase"] as? String
      try require(phase == "CANCELLED" || phase == "COMPLETE")
    }
    try require(target.range(of: "^0x[0-9a-fA-F]{40}$", options: .regularExpression) != nil)
    if let amountAtoms {
      try require(amountAtoms.range(of: "^[1-9][0-9]{0,8}$", options: .regularExpression) != nil)
      try require((Int(amountAtoms) ?? 0) <= 10_000_000)
    }
    let reserved = try allocateSwapRecipients(registry: record.roleRegistry)
    try storage.persistRegistry(reserved.registry, expectedId: record.id)
    var plan: [String: Any] = [
      "kind": "confidentialSwap", "target": target, "recipientIndices": reserved.indices.map { Int($0) },
    ]
    if let amountAtoms { plan["amountAtoms"] = amountAtoms }
    fundingAddress = try deriveAccountAddressRange(entropy: record.entropy, start: 1, count: 1).first
    operation = try SwapOperation.start(
      plan: String(data: JSONSerialization.data(withJSONObject: plan), encoding: .utf8)!,
      entropy: record.entropy, gateway: gateway, nowMs: now())
    try persist()
  }

  func startSell(record: WalletRecord) throws {
    try require(record.verified && record.id == saved.walletId && operation == nil)
    guard let existing = try saved.load(), let state = existing["state"] as? String else { throw WalletFailure.invalid }
    let previous = try SwapOperation.restore(state: state, gateway: gateway)
    let phase = try statusObject(previous.publicStatus())["phase"] as? String
    guard let data = state.data(using: .utf8),
      let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
      let plan = root["plan"] as? [String: Any],
      let kind = plan["kind"] as? String
    else { throw WalletFailure.invalid }
    if phase != "CANCELLED" && phase != "COMPLETE" {
      try require(kind == "confidentialSell")
      fundingAddress = existing["fundingAddress"] as? String
      operation = previous
      return
    }
    try require(kind == "confidentialSwap" && phase == "COMPLETE")
    guard let holders = plan["recipientIndices"] as? [Any], let target = plan["target"] as? String else {
      throw WalletFailure.invalid
    }
    let reserved = try allocateSwapRecipients(registry: record.roleRegistry)
    try storage.persistRegistry(reserved.registry, expectedId: record.id)
    let next: [String: Any] = [
      "kind": "confidentialSell", "target": target, "holderIndices": holders,
      "recipientIndices": reserved.indices.map { Int($0) },
    ]
    fundingAddress = try deriveAccountAddressRange(entropy: record.entropy, start: 1, count: 1).first
    operation = try SwapOperation.start(
      plan: String(data: JSONSerialization.data(withJSONObject: next), encoding: .utf8)!,
      entropy: record.entropy, gateway: gateway, nowMs: now())
    try persist()
  }

  func restore() throws {
    let root = try saved.load()
    fundingAddress = root?["fundingAddress"] as? String
    guard let state = root?["state"] as? String, fundingAddress != nil else { throw WalletFailure.invalid }
    operation = try SwapOperation.restore(state: state, gateway: gateway)
  }

  func advance() async throws -> StoredSwapUi {
    let op = try current()
    for _ in 0..<48 {
      switch try op.nextStep(nowMs: now()) {
      case let .review(text): return .review(text)
      case .unlock: return .unlock
      case .finished, .paused:
        try persist()
        return .done(try view())
      case let .wait(millis):
        if millis > 1_500 {
          try persist()
          return .done(try view())
        }
        try await Task.sleep(nanoseconds: millis * 1_000_000)
      case let .request(id, method, url, body):
        try require(StoredSwapHTTP.allowed(url))
        try persist()
        let response = await StoredSwapHTTP.execute(method, url, body)
        try op.onResponse(id: id, status: response.0, body: response.1, nowMs: now())
        try persist()
      }
    }
    try persist()
    return .done(try view())
  }

  func approve() throws {
    try current().approve(nowMs: now())
    try persist()
  }

  func unlock(record: WalletRecord) throws {
    try require(record.id == saved.walletId)
    try current().unlock(entropy: record.entropy, nowMs: now())
    try persist()
  }

  func cancel() throws {
    try current().cancel()
    try persist()
  }

  func view() throws -> [String: Any] {
    let status = try statusObject(current().publicStatus())
    return [
      "operationId": status["operationId"] as Any, "phase": status["phase"] as Any,
      "step": status["step"] as Any, "pausedCode": status["pausedCode"] as Any,
      "targetSymbol": status["targetSymbol"] as Any, "targetDecimals": status["targetDecimals"] as Any,
      "sourceAtoms": status["sourceAtoms"] as Any, "creditedAtoms": status["creditedAtoms"] as Any,
      "payoutsSubmitted": status["payoutsSubmitted"] as Any, "ordersComplete": status["ordersComplete"] as Any,
      "receivedTargetAtoms": status["receivedTargetAtoms"] as Any, "direction": status["direction"] as Any,
      "returnAddresses": returnAddresses(), "fundingAddress": fundingAddress as Any,
    ]
  }

  private func returnAddresses() -> [String] {
    guard let existing = try? saved.load(), let state = existing["state"] as? String,
      let data = state.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let plan = root["plan"] as? [String: Any], plan["kind"] as? String == "confidentialSell",
      let recipients = root["recipients"] as? [String]
    else { return [] }
    return recipients
  }

  func close() { operation = nil }

  private func current() throws -> SwapOperation {
    guard let operation else { throw WalletFailure.invalid }
    return operation
  }

  private func persist() throws {
    let op = try current()
    guard let fundingAddress else { throw WalletFailure.invalid }
    try saved.save(operationId: op.operationId(), state: op.exportState(), fundingAddress: fundingAddress)
  }

  private func now() -> UInt64 { UInt64(Date().timeIntervalSince1970 * 1000) }

  private func statusObject(_ json: String) throws -> [String: Any] {
    guard let data = json.data(using: .utf8),
      let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { throw WalletFailure.invalid }
    return object
  }
}

internal enum StoredSwapHTTP {
  static func allowed(_ url: String) -> Bool {
    let local = url.hasPrefix("http://127.0.0.1:") || url.hasPrefix("http://localhost:")
      || url.hasPrefix("http://10.0.2.2:")
    return (url.hasPrefix("https://") || local) && !url.contains("?") && !url.contains("#") && url.count <= 300
  }

  static func execute(_ method: String, _ url: String, _ body: String?) async -> (UInt16, String) {
    guard allowed(url), method == "GET" || method == "POST", let endpoint = URL(string: url) else {
      return (0, "")
    }
    var request = URLRequest(url: endpoint)
    request.httpMethod = method
    request.timeoutInterval = 30
    if method == "POST" {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = Data((body ?? "").utf8)
    }
    let config = URLSessionConfiguration.ephemeral
    config.urlCache = nil
    config.httpCookieStorage = nil
    do {
      let (data, response) = try await URLSession(configuration: config).data(for: request)
      guard data.count <= 1_048_576, let http = response as? HTTPURLResponse else { return (0, "") }
      return (UInt16(http.statusCode), String(decoding: data, as: UTF8.self))
    } catch {
      return (0, "")
    }
  }
}
