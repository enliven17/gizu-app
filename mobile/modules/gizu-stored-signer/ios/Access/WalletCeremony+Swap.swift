import CryptoKit
import Foundation

@available(iOS 18.0, *)
@MainActor extension WalletCeremony {
  func swapDeposit() throws -> [String: Any] {
    let record = try store.load()
    defer { record.close() }
    try require(record.verified)
    let address = try deriveAccountAddressRange(entropy: record.entropy, start: 1, count: 1).first
    return ["fundingAddress": address as Any]
  }

  func startSwap(target: String, amountAtoms: String?, gateway: String) async throws -> [String: Any] {
    try await runSwap(gateway: gateway, resume: false, sell: false, target: target, amountAtoms: amountAtoms)
  }

  func startSell(gateway: String) async throws -> [String: Any] {
    try await runSwap(gateway: gateway, resume: false, sell: true, target: nil, amountAtoms: nil)
  }

  func resumeSwap(gateway: String) async throws -> [String: Any] {
    try await runSwap(gateway: gateway, resume: true, sell: false, target: nil, amountAtoms: nil)
  }

  func swapStatus(gateway: String) throws -> [String: Any] {
    let record = try store.load()
    defer { record.close() }
    let engine = try StoredSwapEngine(
      storage: store, saved: StoredSwapFile(store: store, record: record), gateway: gateway)
    defer { engine.close() }
    try engine.restore()
    return try engine.view()
  }

  func cancelSwap(gateway: String) throws -> [String: Any] {
    let record = try store.load()
    defer { record.close() }
    let engine = try StoredSwapEngine(
      storage: store, saved: StoredSwapFile(store: store, record: record), gateway: gateway)
    defer { engine.close() }
    try engine.restore()
    try engine.cancel()
    return try engine.view()
  }

  private func runSwap(gateway: String, resume: Bool, sell: Bool, target: String?, amountAtoms: String?) async throws
    -> [String: Any]
  {
    try require(StoredSwapHTTP.allowed(gateway))
    let record = try store.load()
    let credential = record.credential
    let walletId = record.id
    let engine = try StoredSwapEngine(
      storage: store, saved: StoredSwapFile(store: store, record: record), gateway: gateway)
    defer {
      record.close()
      engine.close()
    }
    if resume {
      try engine.restore()
    } else if sell {
      try engine.startSell(record: record)
    } else {
      try engine.start(record: record, target: target ?? "", amountAtoms: amountAtoms)
    }
    let screen = try await presentWalletUI()
    while true {
      try checkAuthorization()
      switch try await engine.advance() {
      case let .review(text):
        try await screen.confirm("Review swap", text, action: "Approve for 15 minutes")
        let digest = Data(SHA256.hash(data: Data(text.utf8))).map { String(format: "%02x", $0) }.joined()
        let id = try engine.view()["operationId"] as? String ?? ""
        _ = try await authorize(credential, walletId: walletId, purpose: "swap:v1:\(id):\(digest)")
        try checkAuthorization()
        try engine.approve()
      case .unlock:
        try await screen.confirm(
          "New unlock required",
          "The 15-minute authorization ended. Unlock the same plan to continue.",
          action: "Unlock")
        let id = try engine.view()["operationId"] as? String ?? ""
        _ = try await authorize(credential, walletId: walletId, purpose: "swap-unlock:v1:\(id)")
        let fresh = try store.load()
        defer { fresh.close() }
        try engine.unlock(record: fresh)
      case let .done(view):
        return view
      }
    }
  }
}
