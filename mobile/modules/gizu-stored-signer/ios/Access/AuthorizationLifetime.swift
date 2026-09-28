import Foundation

internal struct AuthorizationLifetime {
  private let deadline: TimeInterval
  private(set) var cancelled = false
  init(now: TimeInterval = ProcessInfo.processInfo.systemUptime) { deadline = now + 120 }
  mutating func cancel() { cancelled = true }
  func check(
    now: TimeInterval = ProcessInfo.processInfo.systemUptime, active: Bool, protected: Bool
  ) throws {
    try require(!cancelled && now < deadline && active && protected)
  }
}
