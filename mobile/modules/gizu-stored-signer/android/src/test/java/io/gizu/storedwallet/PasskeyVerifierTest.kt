package io.gizu.storedwallet

import com.upokecenter.cbor.CBORObject
import java.nio.ByteBuffer
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PasskeyVerifierTest {
  private val rpId = "test.example.com"
  private val origin = "android:apk-key-hash:test"
  private val challenge = ByteArray(32) { it.toByte() }
  private val credentialId = byteArrayOf(1, 2, 3, 4)
  private val keyPair: KeyPair =
    KeyPairGenerator.getInstance("EC")
      .apply { initialize(ECGenParameterSpec("secp256r1")) }
      .generateKeyPair()

  @Test
  fun acceptsLocallyBoundRegistrationAndAssertion() {
    val stored = PasskeyVerifier.verifyRegistration(registrationJson(), challenge, rpId, origin)
    assertArrayEquals(credentialId, stored.credentialId)
    PasskeyVerifier.verifyAssertion(assertionJson(), stored, challenge, rpId, origin)
  }

  @Test
  fun acceptsRegistrationWithAuthenticatorExtensions() {
    val stored =
      PasskeyVerifier.verifyRegistration(
        registrationJson(withExtensions = true),
        challenge,
        rpId,
        origin,
      )
    assertArrayEquals(credentialId, stored.credentialId)
  }

  @Test
  fun rejectsWrongChallenge() {
    val stored = PasskeyVerifier.verifyRegistration(registrationJson(), challenge, rpId, origin)
    assertThrows(IllegalArgumentException::class.java) {
      PasskeyVerifier.verifyAssertion(assertionJson(), stored, ByteArray(32) { 99 }, rpId, origin)
    }
  }

  @Test
  fun rejectsMissingUserVerification() {
    val stored = PasskeyVerifier.verifyRegistration(registrationJson(), challenge, rpId, origin)
    assertThrows(IllegalArgumentException::class.java) {
      PasskeyVerifier.verifyAssertion(assertionJson(flags = 0x01), stored, challenge, rpId, origin)
    }
  }

  @Test
  fun rejectsWrongRelyingPartyAndOrigin() {
    val stored = PasskeyVerifier.verifyRegistration(registrationJson(), challenge, rpId, origin)
    assertThrows(IllegalArgumentException::class.java) {
      PasskeyVerifier.verifyAssertion(
        assertionJson(),
        stored,
        challenge,
        "other.example.com",
        origin,
      )
    }
    assertThrows(IllegalArgumentException::class.java) {
      PasskeyVerifier.verifyAssertion(
        assertionJson(),
        stored,
        challenge,
        rpId,
        "android:apk-key-hash:other",
      )
    }
  }

  @Test
  fun rejectsWrongCredentialAndInvalidSignature() {
    val stored = PasskeyVerifier.verifyRegistration(registrationJson(), challenge, rpId, origin)
    val changedCredential = JSONObject(assertionJson()).put("rawId", enc(byteArrayOf(9))).toString()
    assertThrows(IllegalArgumentException::class.java) {
      PasskeyVerifier.verifyAssertion(changedCredential, stored, challenge, rpId, origin)
    }
    val altered = JSONObject(assertionJson())
    altered.getJSONObject("response").put("signature", enc(byteArrayOf(1, 2, 3)))
    assertThrows(Exception::class.java) {
      PasskeyVerifier.verifyAssertion(altered.toString(), stored, challenge, rpId, origin)
    }
  }

  private fun registrationJson(withExtensions: Boolean = false): String {
    val publicKey = keyPair.public as java.security.interfaces.ECPublicKey
    val cose = CBORObject.NewMap()
    cose
      .Add(1, 2)
      .Add(3, -7)
      .Add(-1, 1)
      .Add(-2, fixed32(publicKey.w.affineX.toByteArray()))
      .Add(-3, fixed32(publicKey.w.affineY.toByteArray()))
    val extension =
      if (withExtensions)
        CBORObject.NewMap().Add("prf", CBORObject.NewMap().Add("enabled", true)).EncodeToBytes()
      else ByteArray(0)
    val authData =
      ByteBuffer.allocate(
          37 + 16 + 2 + credentialId.size + cose.EncodeToBytes().size + extension.size
        )
        .put(MessageDigest.getInstance("SHA-256").digest(rpId.toByteArray()))
        .put((if (withExtensions) 0xc5 else 0x45).toByte())
        .putInt(0)
        .put(ByteArray(16))
        .putShort(credentialId.size.toShort())
        .put(credentialId)
        .put(cose.EncodeToBytes())
        .put(extension)
        .array()
    val attestation =
      CBORObject.NewMap()
        .Add("fmt", "none")
        .Add("attStmt", CBORObject.NewMap())
        .Add("authData", authData)
    return JSONObject()
      .put("id", enc(credentialId))
      .put("rawId", enc(credentialId))
      .put("type", "public-key")
      .put(
        "response",
        JSONObject()
          .put("clientDataJSON", enc(clientData("webauthn.create")))
          .put("attestationObject", enc(attestation.EncodeToBytes())),
      )
      .toString()
  }

  private fun assertionJson(flags: Int = 0x05): String {
    val authData =
      ByteBuffer.allocate(37)
        .put(MessageDigest.getInstance("SHA-256").digest(rpId.toByteArray()))
        .put(flags.toByte())
        .putInt(0)
        .array()
    val clientData = clientData("webauthn.get")
    val signature =
      Signature.getInstance("SHA256withECDSA")
        .apply {
          initSign(keyPair.private)
          update(authData)
          update(MessageDigest.getInstance("SHA-256").digest(clientData))
        }
        .sign()
    return JSONObject()
      .put("id", enc(credentialId))
      .put("rawId", enc(credentialId))
      .put("type", "public-key")
      .put(
        "response",
        JSONObject()
          .put("clientDataJSON", enc(clientData))
          .put("authenticatorData", enc(authData))
          .put("signature", enc(signature)),
      )
      .toString()
  }

  private fun clientData(type: String): ByteArray =
    JSONObject()
      .put("type", type)
      .put("challenge", enc(challenge))
      .put("origin", origin)
      .toString()
      .toByteArray()

  private fun enc(bytes: ByteArray): String =
    Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  private fun fixed32(bytes: ByteArray): ByteArray =
    ByteArray(32).also { target ->
      bytes.takeLast(32).toByteArray().copyInto(target, 32 - minOf(32, bytes.size))
    }
}
