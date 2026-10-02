import XCTest
@testable import GizuStoredSignerNative

final class EarnIntentIdentityTests: XCTestCase {
  func testLegacyCycleKeepsItsOriginalIdentity() {
    let identity = storedEarnIntentIdentity(walletId: "Wallet-ID", profile: "ethereum-usdc", cycleIndex: 0)
    XCTAssertEqual(identity.version, "gizu-earn-v1")
    XCTAssertEqual(identity.id, "earn-v1:wallet-id:ethereum-usdc")
  }
  func testNewCyclesMatchAndroidContractForBothProfiles() {
    for profile in ["ethereum-usdc", "robinhood-usdg"] {
      let identity = storedEarnIntentIdentity(walletId: "Wallet-ID", profile: profile, cycleIndex: 7)
      XCTAssertEqual(identity.version, "gizu-earn-v2")
      XCTAssertEqual(identity.id, "earn-v2:wallet-id:\(profile):7")
    }
  }
}
