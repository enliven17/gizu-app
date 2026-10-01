package io.gizu.storedwallet

import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.CreateCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.TimeoutCancellationException
import uniffi.gizu_stored_signer_core.SignerException

internal enum class WalletErrorCode {
  WALLET_CANCELLED,
  WALLET_TIMEOUT,
  NETWORK_ERROR,
  UNAVAILABLE,
  BUSY,
  INVALID_INPUT,
  INVALID_RESPONSE,
  VERIFICATION_FAILED,
  RECOVERY_REQUIRED,
  PASSKEY_FAILED,
  INSUFFICIENT_BALANCE,
  WALLET_STOPPED;

  // No exception message, cause, provider response or secret is exposed to JS/UI.
  val message: String
    get() =
      "Wallet operation stopped. Check wallet state and operation status before retrying. Existing wallet data is not replaced automatically."
}

internal class WalletException(val code: WalletErrorCode) : Exception(code.name)

internal object WalletErrors {
  fun code(error: Throwable): WalletErrorCode =
    when (error) {
      is WalletException -> error.code
      is TimeoutCancellationException,
      is SocketTimeoutException -> WalletErrorCode.WALLET_TIMEOUT
      is CancellationException,
      is CreateCredentialCancellationException,
      is GetCredentialCancellationException -> WalletErrorCode.WALLET_CANCELLED
      is CreateCredentialException,
      is GetCredentialException -> WalletErrorCode.PASSKEY_FAILED
      is SignerException.InvalidInput -> WalletErrorCode.INVALID_INPUT
      is SignerException.CryptoFailed -> WalletErrorCode.VERIFICATION_FAILED
      is SignerException.Expired -> WalletErrorCode.WALLET_TIMEOUT
      is RpcFailure ->
        when (error.code) {
          RpcFailureCode.TIMEOUT -> WalletErrorCode.WALLET_TIMEOUT
          RpcFailureCode.NETWORK -> WalletErrorCode.NETWORK_ERROR
          RpcFailureCode.HTTP -> WalletErrorCode.UNAVAILABLE
          RpcFailureCode.INSUFFICIENT_FUNDS -> WalletErrorCode.INSUFFICIENT_BALANCE
          RpcFailureCode.RESPONSE_TOO_LARGE,
          RpcFailureCode.RPC -> WalletErrorCode.INVALID_RESPONSE
        }
      is java.security.GeneralSecurityException -> WalletErrorCode.VERIFICATION_FAILED
      is IllegalArgumentException -> WalletErrorCode.INVALID_INPUT
      else -> WalletErrorCode.WALLET_STOPPED
    }
}

internal enum class WalletStage {
  CEREMONY,
  BACKUP,
  TRANSFER,
  SWAP_START,
  SWAP_APPROVAL,
  SWAP_UNLOCK,
}

internal object WalletDiagnostics {
  fun line(stage: WalletStage, error: Throwable): String =
    "stage=${stage.name} code=${WalletErrors.code(error).name}"

  fun failed(stage: WalletStage, error: Throwable) {
    android.util.Log.w("GizuWallet", line(stage, error))
  }
}
