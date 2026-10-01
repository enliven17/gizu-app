import AuthenticationServices
import XCTest

@testable import GizuStoredSignerNative

final class WalletDiagnosticsTests: XCTestCase {
  func testBridgeCodesDoNotConfuseFailureWithCancellation() {
    XCTAssertEqual(WalletDiagnostics.bridgeCode(CancellationError()), "WALLET_CANCELLED")
    XCTAssertEqual(WalletDiagnostics.bridgeCode(WalletFailure.cancelled), "WALLET_CANCELLED")
    XCTAssertEqual(WalletDiagnostics.bridgeCode(WalletFailure.invalid), "WALLET_STOPPED")
    XCTAssertEqual(WalletDiagnostics.bridgeCode(WalletFailure.busy), "BUSY")
    for (code, expected) in [
      (ASAuthorizationError.canceled.rawValue, "WALLET_CANCELLED"),
      (ASAuthorizationError.failed.rawValue, "PASSKEY_FAILED"),
    ] {
      XCTAssertEqual(
        WalletDiagnostics.bridgeCode(NSError(domain: ASAuthorizationError.errorDomain, code: code)),
        expected)
      XCTAssertEqual(
        WalletDiagnostics.bridgeCode(NSError(domain: "untrusted", code: code)), "WALLET_STOPPED")
    }
  }

  func testAppleCodesRemainDistinctWithoutLeakingErrorPayloads() {
    let secret = "private-credential-and-wallet-data"
    for code in [1001, 1004] {
      let error = NSError(
        domain: ASAuthorizationError.errorDomain, code: code,
        userInfo: [
          NSLocalizedDescriptionKey: secret,
          NSUnderlyingErrorKey:
            NSError(domain: secret, code: 99),
        ])
      XCTAssertEqual(WalletDiagnostics.errorSummary(error), "apple.authorization:\(code)")
    }
    XCTAssertEqual(
      WalletDiagnostics.errorSummary(NSError(domain: secret, code: 99)), "unclassified")
    XCTAssertEqual(WalletDiagnostics.errorSummary(WalletFailure.cancelled), "wallet.cancelled")
    XCTAssertEqual(WalletDiagnostics.errorSummary(CancellationError()), "task.cancelled")
  }
}
