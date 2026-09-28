import XCTest

@testable import GizuStoredSignerNative

final class AuthorizationLifetimeTests: XCTestCase {
  func testAuthorityExpiresAndNeverRevivesAfterCancel() throws {
    var lifetime = AuthorizationLifetime(now: 100)
    try lifetime.check(now: 219, active: true, protected: true)
    XCTAssertThrowsError(try lifetime.check(now: 220, active: true, protected: true))
    XCTAssertThrowsError(try lifetime.check(now: 101, active: false, protected: true))
    XCTAssertThrowsError(try lifetime.check(now: 101, active: true, protected: false))
    lifetime.cancel()
    XCTAssertThrowsError(try lifetime.check(now: 102, active: true, protected: true))
  }
}
