import Foundation

internal struct AuthorizationLifetime {
  enum Window { case wallet, swap }
  private let deadline: TimeInterval
  private(set) var cancelled = false
  init(now: TimeInterval = ProcessInfo.processInfo.systemUptime, window: Window = .wallet) {
    deadline = now + (window == .swap ? 900 : 120)
  }
  mutating func cancel() { cancelled = true }
  func check(
    now: TimeInterval = ProcessInfo.processInfo.systemUptime, active: Bool, protected: Bool
  ) throws {
    try require(!cancelled && now < deadline && active && protected)
  }
}
