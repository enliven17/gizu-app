import AuthenticationServices
import XCTest

@testable import GizuStoredSignerNative

final class WalletDiagnosticsTests: XCTestCase {
  func testBridgeCodesDoNotConfuseFailureWithCancellation() {
    XCTAssertEqual(WalletDiagnostics.bridgeCode(CancellationError()), "WALLET_CANCELLED")
    XCTAssertEqual(WalletDiagnostics.bridgeCode(WalletFailure.cancelled), "WALLET_CANCELLED")
    XCTAssertEqual(WalletDiagnostics.bridgeCode(WalletFailure.invalid), "INVALID_INPUT")
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

  func testRustCodesMatchSharedFixture() throws {
    let url = try XCTUnwrap(
      Bundle.module.url(
        forResource: "native-error-codes", withExtension: "json", subdirectory: "Fixtures"))
    let codes = try JSONDecoder().decode([String: String].self, from: Data(contentsOf: url))
    for (name, error) in [
      ("InvalidInput", SignerError.InvalidInput), ("CryptoFailed", SignerError.CryptoFailed),
      ("Expired", SignerError.Expired),
    ] {
      XCTAssertEqual(WalletErrors.code(error), codes[name])
    }
  }

  func testTransportAndStorageErrorsUseSafeCategories() {
    for (error, code) in [
      (NSURLErrorTimedOut, "WALLET_TIMEOUT"),
      (NSURLErrorCancelled, "WALLET_CANCELLED"),
      (NSURLErrorNotConnectedToInternet, "NETWORK_ERROR"),
    ] {
      let failure = NSError(
        domain: NSURLErrorDomain, code: error, userInfo: [NSLocalizedDescriptionKey: "secret-url"])
      XCTAssertEqual(WalletErrors.code(failure), code)
      XCTAssertFalse(WalletDiagnostics.errorSummary(failure).contains("secret-url"))
    }
    XCTAssertEqual(WalletErrors.code(WalletFailure.recoveryRequired), "RECOVERY_REQUIRED")
    XCTAssertEqual(WalletErrors.code(WalletFailure.expired), "WALLET_TIMEOUT")
    XCTAssertEqual(WalletErrors.code(WalletFailure.invalidResponse), "INVALID_RESPONSE")
    XCTAssertEqual(WalletErrors.code(WalletFailure.insufficientBalance), "INSUFFICIENT_BALANCE")
    XCTAssertEqual(WalletErrors.code(WalletFailure.unavailable), "UNAVAILABLE")
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
