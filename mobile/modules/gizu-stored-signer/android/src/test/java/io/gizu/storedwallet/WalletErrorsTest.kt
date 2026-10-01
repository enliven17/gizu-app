package io.gizu.storedwallet

import androidx.credentials.exceptions.CreateCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialUnknownException
import java.net.SocketTimeoutException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import uniffi.gizu_stored_signer_core.SignerException

class WalletErrorsTest {
  @Test
  fun rustCodesMatchSharedFixture() {
    val codes =
      JSONObject(
        javaClass.classLoader!!
          .getResourceAsStream("native-error-codes.json")!!
          .bufferedReader()
          .use { it.readText() }
      )
    for ((name, error) in
      listOf(
        "InvalidInput" to SignerException.InvalidInput(),
        "CryptoFailed" to SignerException.CryptoFailed(),
        "Expired" to SignerException.Expired(),
      )) assertEquals(codes.getString(name), WalletErrors.code(error).name)
  }

  @Test
  fun timeoutIsNotUserCancellation() = runBlocking {
    val failure =
      try {
        withTimeout(1) { awaitCancellation() }
      } catch (error: Exception) {
        error
      }
    assertEquals(WalletErrorCode.WALLET_TIMEOUT, WalletErrors.code(failure))
    assertEquals(
      WalletErrorCode.WALLET_TIMEOUT,
      WalletErrors.code(SocketTimeoutException("secret")),
    )
    for (error in
      listOf(
        CancellationException("secret"),
        CreateCredentialCancellationException("secret"),
        GetCredentialCancellationException("secret"),
      )) {
      assertEquals(WalletErrorCode.WALLET_CANCELLED, WalletErrors.code(error))
    }
    assertEquals(
      WalletErrorCode.PASSKEY_FAILED,
      WalletErrors.code(GetCredentialUnknownException("secret")),
    )
  }

  @Test
  fun transportAndStorageRemainDistinct() {
    assertEquals(
      WalletErrorCode.NETWORK_ERROR,
      WalletErrors.code(RpcFailure(RpcFailureCode.NETWORK)),
    )
    assertEquals(
      WalletErrorCode.WALLET_TIMEOUT,
      WalletErrors.code(RpcFailure(RpcFailureCode.TIMEOUT)),
    )
    assertEquals(
      WalletErrorCode.INVALID_RESPONSE,
      WalletErrors.code(RpcFailure(RpcFailureCode.RESPONSE_TOO_LARGE)),
    )
    assertEquals(
      WalletErrorCode.INSUFFICIENT_BALANCE,
      WalletErrors.code(RpcFailure(RpcFailureCode.INSUFFICIENT_FUNDS)),
    )
    assertEquals(
      WalletErrorCode.RECOVERY_REQUIRED,
      WalletErrors.code(WalletException(WalletErrorCode.RECOVERY_REQUIRED)),
    )
  }

  @Test
  fun diagnosticsNeverIncludeExceptionPayloadsOrCauses() {
    val error = IllegalStateException("private-wallet-file", RuntimeException("credential-secret"))
    assertEquals(
      "stage=SWAP_START code=WALLET_STOPPED",
      WalletDiagnostics.line(WalletStage.SWAP_START, error),
    )
    val sanitized = WalletException(WalletErrors.code(error))
    assertNull(sanitized.cause)
    assertFalse(sanitized.message!!.contains("private-wallet-file"))
    assertFalse(WalletErrors.code(error).message.contains("credential-secret"))
  }
}
