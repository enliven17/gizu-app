package io.gizu.storedwallet

import android.app.Activity
import android.content.pm.PackageManager
import androidx.credentials.*
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/**
 * Internal only. Fresh challenges bind an assertion to its native purpose; no JS challenge input.
 */
internal class PasskeyGate(private val activity: Activity) {
  private val manager = CredentialManager.create(activity)

  private fun random() = ByteArray(32).also { SecureRandom().nextBytes(it) }

  private fun encode(bytes: ByteArray) =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  private val rp = "gizu.io"

  suspend fun register(): StoredPasskey {
    val challenge = random()
    val request =
      JSONObject()
        .put("challenge", encode(challenge))
        .put("rp", JSONObject().put("id", rp).put("name", "Gizu"))
        .put(
          "user",
          JSONObject()
            .put("id", encode(random()))
            .put("name", "gizu-stored-wallet")
            .put("displayName", "Gizu testnet wallet"),
        )
        .put(
          "pubKeyCredParams",
          JSONArray().put(JSONObject().put("type", "public-key").put("alg", -7)),
        )
        .put(
          "authenticatorSelection",
          JSONObject().put("residentKey", "required").put("userVerification", "required"),
        )
        .put("attestation", "none")
        .put("timeout", 120000)
        .put("extensions", JSONObject().put("prf", JSONObject()))
    val response =
      manager.createCredential(activity, CreatePublicKeyCredentialRequest(request.toString()))
        as? CreatePublicKeyCredentialResponse ?: error("Unsupported credential")
    check(
      JSONObject(response.registrationResponseJson)
        .optJSONObject("clientExtensionResults")
        ?.optJSONObject("prf")
        ?.optBoolean("enabled", false) == true
    ) {
      "Recovery PRF unsupported"
    }
    return PasskeyVerifier.verifyRegistration(
      response.registrationResponseJson,
      challenge,
      rp,
      origin(),
    )
  }

  suspend fun authorize(credential: StoredPasskey, walletId: String, purpose: String = "open:v1") {
    val challenge =
      MessageDigest.getInstance("SHA-256")
        .digest("gizu-stored-wallet:$purpose:$walletId:".toByteArray() + random())
    val request =
      JSONObject()
        .put("challenge", encode(challenge))
        .put("rpId", rp)
        .put(
          "allowCredentials",
          JSONArray()
            .put(JSONObject().put("type", "public-key").put("id", encode(credential.credentialId))),
        )
        .put("userVerification", "required")
        .put("timeout", 120000)
    val result =
      manager
        .getCredential(
          activity,
          GetCredentialRequest(listOf(GetPublicKeyCredentialOption(request.toString()))),
        )
        .credential as? PublicKeyCredential ?: error("Unsupported credential")
    PasskeyVerifier.verifyAssertion(
      result.authenticationResponseJson,
      credential,
      challenge,
      rp,
      origin(),
    )
  }

  suspend fun recoveryPrf(credential: StoredPasskey): ByteArray {
    val challenge = random()
    val salt =
      MessageDigest.getInstance("SHA-256")
        .digest("gizu.stored-wallet.recovery-prf.v1".toByteArray())
    val request =
      JSONObject()
        .put("challenge", encode(challenge))
        .put("rpId", rp)
        .put(
          "allowCredentials",
          JSONArray()
            .put(JSONObject().put("type", "public-key").put("id", encode(credential.credentialId))),
        )
        .put("userVerification", "required")
        .put("timeout", 120000)
        .put(
          "extensions",
          JSONObject().put("prf", JSONObject().put("eval", JSONObject().put("first", encode(salt)))),
        )
    val result =
      manager
        .getCredential(
          activity,
          GetCredentialRequest(listOf(GetPublicKeyCredentialOption(request.toString()))),
        )
        .credential as? PublicKeyCredential ?: error("Unsupported credential")
    PasskeyVerifier.verifyAssertion(
      result.authenticationResponseJson,
      credential,
      challenge,
      rp,
      origin(),
    )
    val bytes =
      Base64.getUrlDecoder()
        .decode(
          JSONObject(result.authenticationResponseJson)
            .getJSONObject("clientExtensionResults")
            .getJSONObject("prf")
            .getJSONObject("results")
            .getString("first")
        )
    if (bytes.size != 32) {
      bytes.fill(0)
      error("Invalid PRF")
    }
    return bytes
  }

  @Suppress("DEPRECATION")
  private fun origin(): String {
    val info =
      activity.packageManager.getPackageInfo(
        activity.packageName,
        PackageManager.GET_SIGNING_CERTIFICATES,
      )
    val signature =
      info.signingInfo?.apkContentsSigners?.singleOrNull() ?: error("Signing identity unavailable")
    return "android:apk-key-hash:${encode(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()))}"
  }
}
