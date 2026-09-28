import Foundation

internal enum TransferReviewText {
  static func retry(_ step: StoredStep, fee: StoredFee, nonce: String, hash: String) throws
    -> String
  {
    return """
      Retry exactly this previously signed transaction. No new signature or fee change.

      Account \(step.accountIndex)
      From \(step.from)
      To \(step.to)
      Amount \(decimalText(try decimalValue(step.valueWei) / 1_000_000_000_000_000_000)) MON
      Nonce \(nonce)
      Gas \(decimalText(try quantity(fee.gas)))
      Max fee/gas \(decimalText(try quantity(fee.maxFee))) wei
      Priority/gas \(decimalText(try quantity(fee.priorityFee))) wei
      Maximum fee \(decimalText(try quantity(fee.maxFee) * Decimal(WalletLimits.nativeTransferGas))) wei
      Hash \(hash)

      Chain 10143 · Monad testnet. Refresh status before resuming remaining steps.
      """
  }
}
