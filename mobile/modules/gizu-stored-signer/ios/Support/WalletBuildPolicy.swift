import Foundation

internal enum WalletBuildPolicy {
  static func isAvailable(info: [String: Any] = Bundle.main.infoDictionary ?? [:]) -> Bool {
    guard #available(iOS 18.0, *) else { return false }
    #if DEBUG
      return true
    #else
      // This flag is embedded in the signed binary, never supplied by JavaScript.
      // Enabling beta access does not change Rust's Monad testnet transaction policy.
      return info["GizuTestnetWalletEnabled"] as? Bool == true
    #endif
  }
}
