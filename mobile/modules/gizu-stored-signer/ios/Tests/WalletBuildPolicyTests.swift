import XCTest

@testable import GizuStoredSignerNative

final class WalletBuildPolicyTests: XCTestCase {
  func testReleaseRequiresExplicitNativeTestnetOptIn() {
    #if DEBUG
      XCTAssertTrue(WalletBuildPolicy.isAvailable(info: [:]))
    #else
      XCTAssertFalse(WalletBuildPolicy.isAvailable(info: [:]))
      XCTAssertFalse(WalletBuildPolicy.isAvailable(info: ["GizuWalletEnabled": false]))
      XCTAssertFalse(WalletBuildPolicy.isAvailable(info: ["GizuWalletEnabled": "true"]))
    #endif
    XCTAssertTrue(WalletBuildPolicy.isAvailable(info: ["GizuWalletEnabled": true]))
  }
}
