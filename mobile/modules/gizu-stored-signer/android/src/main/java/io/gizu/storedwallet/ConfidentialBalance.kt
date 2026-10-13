package io.gizu.storedwallet

import io.gizu.storedwallet.portfolio.PortfolioDiagnostics
import java.math.BigInteger
import org.json.JSONObject
import uniffi.gizu_stored_signer_core.EarnReadAuthentication

/** Fixed endpoints; neither URLs nor signed auth/session credentials cross Expo. */
internal class ConfidentialBalance {
  suspend fun salt(): ByteArray {
    val request =
      JSONObject()
        .put("jsonrpc", "2.0")
        .put("id", "earn-salt")
        .put("method", "query")
        .put(
          "params",
          JSONObject()
            .put("request_type", "call_function")
            .put("finality", "final")
            .put("account_id", "intents.near")
            .put("method_name", "current_salt")
            .put("args_base64", ""),
        )
    PortfolioDiagnostics.event(
      PortfolioDiagnostics.Stage.PRIVATE_SALT,
      PortfolioDiagnostics.Reason.STARTED,
    )
    try {
      return parseSalt(NativeRpcTransport("https://rpc.mainnet.near.org").post(request.toString()))
        .also {
          PortfolioDiagnostics.event(
            PortfolioDiagnostics.Stage.PRIVATE_SALT,
            PortfolioDiagnostics.Reason.READY,
          )
        }
    } catch (failure: Exception) {
      PortfolioDiagnostics.event(
        PortfolioDiagnostics.Stage.PRIVATE_SALT,
        PortfolioDiagnostics.Reason.UNAVAILABLE,
        failure = failure,
      )
      throw failure
    }
  }

  suspend fun read(auth: EarnReadAuthentication, address: String): Map<String, Any> {
    val body =
      JSONObject()
        .put(
          "signedData",
          JSONObject()
            .put("standard", "erc191")
            .put("payload", auth.payload)
            .put("signature", auth.signature),
        )
    PortfolioDiagnostics.event(
      PortfolioDiagnostics.Stage.PRIVATE_READ,
      PortfolioDiagnostics.Reason.STARTED,
      143L,
    )
    try {
      val response = NativeRpcTransport(EARN_PRIVATE_BALANCE_BACKEND).post(body.toString())
      return publicBalance(response, address, System.currentTimeMillis()).also {
        PortfolioDiagnostics.event(
          PortfolioDiagnostics.Stage.PRIVATE_READ,
          PortfolioDiagnostics.Reason.READY,
          143L,
        )
      }
    } catch (failure: Exception) {
      PortfolioDiagnostics.event(
        PortfolioDiagnostics.Stage.PRIVATE_READ,
        PortfolioDiagnostics.Reason.UNAVAILABLE,
        143L,
        failure = failure,
      )
      throw failure
    }
  }

  companion object {
    private fun validate(valid: Boolean, reason: PortfolioDiagnostics.Reason) {
      if (!valid)
        PortfolioDiagnostics.event(PortfolioDiagnostics.Stage.PRIVATE_VALIDATION, reason, 143L)
      check(valid) { reason.name }
    }

    fun parseSalt(text: String): ByteArray {
      val response = JSONObject(text)
      check(
        response.getString("jsonrpc") == "2.0" &&
          response.getString("id") == "earn-salt" &&
          !response.has("error")
      )
      val bytes = response.getJSONObject("result").getJSONArray("result")
      check(bytes.length() == 10)
      val decoded =
        ByteArray(bytes.length()) { i ->
          val value = bytes.get(i)
          check(value is Int && value in 0..255)
          value.toByte()
        }
      val salt = JSONObject("{\"salt\":" + String(decoded, Charsets.UTF_8) + "}").getString("salt")
      check(Regex("^[0-9a-fA-F]{8}$").matches(salt))
      return ByteArray(4) { i -> salt.substring(i * 2, i * 2 + 2).toInt(16).toByte() }
    }

    fun publicBalance(text: String, address: String, now: Long): Map<String, Any> {
      val row = JSONObject(text)
      val received = row.getString("confidentialAddress")
      validate(
        Regex("^0x[0-9a-fA-F]{40}$").matches(received) && received.equals(address, true),
        PortfolioDiagnostics.Reason.ADDRESS_BINDING_INVALID,
      )
      validate(
        row.get("authenticated") == true && row.get("operationScoped") == false,
        PortfolioDiagnostics.Reason.AUTH_FLAGS_INVALID,
      )
      val asset = row.getString("assetId")
      validate(
        asset == "nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx",
        PortfolioDiagnostics.Reason.ASSET_INVALID,
      )
      validate(
        row.get("available") is String &&
          row.get("assetId") is String &&
          row.get("confidentialAddress") is String,
        PortfolioDiagnostics.Reason.AMOUNT_TYPE_INVALID,
      )
      val available = row.getString("available")
      validate(
        Regex("^(0|[1-9][0-9]{0,77})$").matches(available) &&
          BigInteger(available).bitLength() <= 256,
        PortfolioDiagnostics.Reason.AMOUNT_INVALID,
      )
      validate(
        row.get("timestampMs") is Long || row.get("timestampMs") is Int,
        PortfolioDiagnostics.Reason.TIMESTAMP_TYPE_INVALID,
      )
      val timestamp = row.getLong("timestampMs")
      validate(
        timestamp >= 0 && now - timestamp in -5000L..60000L,
        PortfolioDiagnostics.Reason.TIMESTAMP_INVALID,
      )
      return mapOf(
        "confidentialAddress" to address,
        "assetId" to asset,
        "available" to available,
        "timestampMs" to timestamp,
        "authenticated" to true,
        "operationScoped" to false,
      )
    }
  }
}
