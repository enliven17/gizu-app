package io.gizu.storedwallet

import com.upokecenter.cbor.CBORObject
import com.upokecenter.cbor.CBORType
import java.io.ByteArrayInputStream
import java.math.BigInteger
import java.nio.ByteBuffer
import java.security.AlgorithmParameters
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.security.spec.ECParameterSpec
import java.security.spec.ECPoint
import java.security.spec.ECPublicKeySpec
import java.util.Base64
import org.json.JSONObject

class StoredPasskey(
  val credentialId: ByteArray,
  val publicKeyX: ByteArray,
  val publicKeyY: ByteArray,
)

object PasskeyVerifier {
  fun verifyRegistration(
    json: String,
    challenge: ByteArray,
    rpId: String,
    origin: String,
  ): StoredPasskey {
    require(json.length <= 65536)
    val credential = JSONObject(json)
    require(credential.getString("type") == "public-key")
    val id = decode(credential.getString("rawId"))
    require(MessageDigest.isEqual(id, decode(credential.getString("id"))))
    val response = credential.getJSONObject("response")
    checkClientData(response.getString("clientDataJSON"), "webauthn.create", challenge, origin)

    val attestation = CBORObject.DecodeFromBytes(decode(response.getString("attestationObject")))
    require(attestation["fmt"].AsString() == "none")
    require(attestation["attStmt"].size() == 0)
    val authData = attestation["authData"].GetByteString()
    checkAuthenticatorData(authData, rpId, requireAttestedKey = true)
    require(authData.size >= 55)
    val idLength = ByteBuffer.wrap(authData, 53, 2).short.toInt() and 0xffff
    require(idLength in 1..1024 && authData.size > 55 + idLength)
    require(MessageDigest.isEqual(id, authData.copyOfRange(55, 55 + idLength)))
    val remaining = ByteArrayInputStream(authData, 55 + idLength, authData.size - 55 - idLength)
    val cose = CBORObject.Read(remaining)
    require(cose.type == CBORType.Map)
    if (authData[32].toInt() and 0x80 != 0) {
      require(CBORObject.Read(remaining).type == CBORType.Map) {
        "Invalid authenticator extensions"
      }
    }
    require(remaining.available() == 0) { "Unexpected authenticator data" }
    require(cose[CBORObject.FromObject(1)].AsInt32() == 2)
    require(cose[CBORObject.FromObject(3)].AsInt32() == -7)
    require(cose[CBORObject.FromObject(-1)].AsInt32() == 1)
    val x = cose[CBORObject.FromObject(-2)].GetByteString()
    val y = cose[CBORObject.FromObject(-3)].GetByteString()
    require(x.size == 32 && y.size == 32)
    return StoredPasskey(id, x, y)
  }

  fun verifyAssertion(
    json: String,
    credential: StoredPasskey,
    challenge: ByteArray,
    rpId: String,
    origin: String,
  ) {
    require(json.length <= 65536)
    val parsed = JSONObject(json)
    require(parsed.getString("type") == "public-key")
    require(MessageDigest.isEqual(credential.credentialId, decode(parsed.getString("rawId"))))
    require(MessageDigest.isEqual(credential.credentialId, decode(parsed.getString("id"))))
    val response = parsed.getJSONObject("response")
    val clientData =
      checkClientData(response.getString("clientDataJSON"), "webauthn.get", challenge, origin)
    val authData = decode(response.getString("authenticatorData"))
    checkAuthenticatorData(authData, rpId, requireAttestedKey = false)

    val params =
      AlgorithmParameters.getInstance("EC")
        .apply { init(ECGenParameterSpec("secp256r1")) }
        .getParameterSpec(ECParameterSpec::class.java)
    val key =
      KeyFactory.getInstance("EC")
        .generatePublic(
          ECPublicKeySpec(
            ECPoint(BigInteger(1, credential.publicKeyX), BigInteger(1, credential.publicKeyY)),
            params,
          )
        )
    val verified =
      Signature.getInstance("SHA256withECDSA")
        .apply {
          initVerify(key)
          update(authData)
          update(sha256(clientData))
        }
        .verify(decode(response.getString("signature")))
    require(verified) { "Invalid passkey assertion signature" }
  }

  private fun checkClientData(
    encoded: String,
    type: String,
    challenge: ByteArray,
    origin: String,
  ): ByteArray {
    val bytes = decode(encoded)
    val data = JSONObject(String(bytes, Charsets.UTF_8))
    require(data.getString("type") == type)
    require(MessageDigest.isEqual(decode(data.getString("challenge")), challenge))
    require(data.getString("origin") == origin)
    require(!data.optBoolean("crossOrigin", false))
    return bytes
  }

  private fun checkAuthenticatorData(data: ByteArray, rpId: String, requireAttestedKey: Boolean) {
    require(data.size >= 37)
    require(
      MessageDigest.isEqual(data.copyOfRange(0, 32), sha256(rpId.toByteArray(Charsets.UTF_8)))
    )
    val flags = data[32].toInt() and 0xff
    require(flags and 0x01 != 0) { "User presence required" }
    require(flags and 0x04 != 0) { "User verification required" }
    require((flags and 0x40 != 0) == requireAttestedKey)
  }

  private fun decode(value: String): ByteArray = Base64.getUrlDecoder().decode(value)

  private fun sha256(bytes: ByteArray): ByteArray =
    MessageDigest.getInstance("SHA-256").digest(bytes)
}
