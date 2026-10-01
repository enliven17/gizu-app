import AuthenticationServices
import CryptoKit
import Foundation

/// Classification only. Never inspect error descriptions or forward underlying payloads.
internal enum WalletErrors {
  static func code(_ error: Error) -> String {
    if error is CancellationError { return "WALLET_CANCELLED" }
    if let failure = error as? WalletFailure {
      switch failure {
      case .cancelled: return "WALLET_CANCELLED"
      case .expired: return "WALLET_TIMEOUT"
      case .busy: return "BUSY"
      case .unavailable: return "UNAVAILABLE"
      case .invalid: return "INVALID_INPUT"
      case .invalidResponse: return "INVALID_RESPONSE"
      case .recoveryRequired: return "RECOVERY_REQUIRED"
      case .insufficientBalance: return "INSUFFICIENT_BALANCE"
      }
    }
    if let failure = error as? SignerError {
      switch failure {
      case .InvalidInput: return "INVALID_INPUT"
      case .CryptoFailed: return "VERIFICATION_FAILED"
      case .Expired: return "WALLET_TIMEOUT"
      }
    }
    if error is CryptoKitError { return "VERIFICATION_FAILED" }
    let native = error as NSError
    if native.domain == ASAuthorizationError.errorDomain {
      return native.code == ASAuthorizationError.canceled.rawValue
        ? "WALLET_CANCELLED" : "PASSKEY_FAILED"
    }
    if native.domain == NSURLErrorDomain {
      switch native.code {
      case NSURLErrorCancelled: return "WALLET_CANCELLED"
      case NSURLErrorTimedOut: return "WALLET_TIMEOUT"
      default: return "NETWORK_ERROR"
      }
    }
    return "WALLET_STOPPED"
  }
}
