import AuthenticationServices
import CryptoKit
import UIKit

@available(iOS 18.0, *)
@MainActor
internal final class StoredPasskeyGate: NSObject, ASAuthorizationControllerDelegate,
  ASAuthorizationControllerPresentationContextProviding
{
  private let diagnostics: WalletDiagnostics
  private let window: UIWindow
  private var continuation: CheckedContinuation<ASAuthorizationCredential, Error>?
  private var controller: ASAuthorizationController?
  init(window: UIWindow, diagnostics: WalletDiagnostics) {
    self.window = window
    self.diagnostics = diagnostics
  }
  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    window
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) { finish(.success(authorization.credential)) }
  func authorizationController(
    controller: ASAuthorizationController, didCompleteWithError error: Error
  ) {
    diagnostics.failed(error)
    finish(.failure(error))
  }
  private func finish(_ result: Result<ASAuthorizationCredential, Error>) {
    let pending = continuation
    continuation = nil
    controller = nil
    pending?.resume(with: result)
  }

  func cancel() {
    let active = controller
    finish(.failure(WalletFailure.cancelled))
    active?.cancel()
  }

  private func request(_ request: ASAuthorizationRequest) async throws -> ASAuthorizationCredential
  {
    try Task.checkCancellation()
    return try await withTaskCancellationHandler {
      try await withCheckedThrowingContinuation { continuation in
        self.continuation = continuation
        let controller = ASAuthorizationController(authorizationRequests: [request])
        self.controller = controller
        controller.delegate = self
        controller.presentationContextProvider = self
        controller.performRequests()
      }
    } onCancel: {
      Task { @MainActor in self.cancel() }
    }
  }
  func register() async throws -> StoredCredential {
    diagnostics.mark("passkey-registration")
    let challenge = try randomBytes()
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: StoredPasskeyVerifier.rp)
    let registration = provider.createCredentialRegistrationRequest(
      challenge: challenge, name: "Gizu wallet", userID: try randomBytes())
    registration.userVerificationPreference = .required
    registration.attestationPreference = .none
    registration.prf = .checkForSupport
    guard
      let result = try await request(registration)
        as? ASAuthorizationPlatformPublicKeyCredentialRegistration,
      let attestation = result.rawAttestationObject
    else { throw WalletFailure.invalid }
    // The recovery assertion below proves PRF availability before any wallet entropy is generated.
    diagnostics.mark("registration-verification")
    return try StoredPasskeyVerifier.registration(
      id: result.credentialID, clientData: result.rawClientDataJSON, attestation: attestation,
      challenge: challenge)
  }

  func authorize(
    _ credential: StoredCredential, walletId: String, purpose: String, recovery: Bool = false
  ) async throws -> Data? {
    diagnostics.mark("passkey-assertion")
    let challenge = try digest(
      Data("gizu-stored-wallet:\(purpose):\(walletId):".utf8) + randomBytes())
    let provider = ASAuthorizationPlatformPublicKeyCredentialProvider(
      relyingPartyIdentifier: StoredPasskeyVerifier.rp)
    let assertion = provider.createCredentialAssertionRequest(challenge: challenge)
    assertion.allowedCredentials = [
      ASAuthorizationPlatformPublicKeyCredentialDescriptor(credentialID: credential.id)
    ]
    assertion.userVerificationPreference = .required
    if recovery {
      assertion.prf = .inputValues(
        .saltInput1(digest(Data("gizu.stored-wallet.recovery-prf.v1".utf8))))
    }

    guard
      let result = try await request(assertion)
        as? ASAuthorizationPlatformPublicKeyCredentialAssertion
    else { throw WalletFailure.invalid }
    diagnostics.mark("assertion-verification")
    try StoredPasskeyVerifier.assertion(
      id: result.credentialID, clientData: result.rawClientDataJSON,
      auth: result.rawAuthenticatorData, signature: result.signature, credential: credential,
      challenge: challenge)
    if recovery {
      diagnostics.mark("prf-validation")
      guard let secret = result.prf?.first else { throw WalletFailure.unavailable }
      let bytes = secret.withUnsafeBytes { Data($0) }
      try require(bytes.count == 32)
      return bytes
    }

    return nil
  }
}
