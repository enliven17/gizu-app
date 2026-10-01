# Passkey identity and configuration

The previous native signer is retained but disconnected. Android development builds
implement `GizuStoredSigner`: encrypted wallet storage, passkey create/open,
verified backup/restore, native transfer approval and explicit operation resume.
Access requires Android API 28+, the installed native module and a compatible
credential provider. New wallets must complete backup verification before app access.
iOS 18+ wallet support and production build configuration are implemented;
physical-device/provider acceptance remains pending.
See [native signer architecture](NATIVE_SIGNER.md) for the active contract. Wallet
entropy is randomly generated and encrypted locally; the passkey authorizes access
and its PRF protects backups. It no longer determines wallet addresses.
The frozen derivation below documents the retained module only, not the new wallet
model. App identifiers/domain associations remain valid configuration inputs.
See [Android signing](ANDROID_SIGNING.md) for development association setup and
[verification](NATIVE_SIGNER_VERIFICATION.md) for device evidence and limitations.
Apple Team ID `588X2UZY3L` is configured; production release acceptance remains open.

## Retained signer identity

The source of truth is `src/config/passkey-identity.json`:

- RP ID: `gizu.io`, shared by development, production, web and mobile.
- Apple Team ID: `588X2UZY3L`; development bundle: `com.example.gizu.dev`.
  The bundle must be registered/signed under that team with Associated Domains.
  Release identity is still unresolved and production builds remain blocked.
- One EVM account, derivation `mera-evm-v1`: 32-byte PRF entropy → English BIP-39
  mnemonic → seed with empty passphrase → BIP-32 `m/44'/60'/0'/0/0`.
- PRF salt: SHA-256 of UTF-8 `mera.prf.salt.v1`, matching Mera's fixed default.
- Initial native eligibility: iOS 18+ and a PRF-capable provider. Android probe eligibility is API 28+ with provider support; OS checks alone
  do not establish PRF support or release acceptance.
- Persist metadata only. No PRF, mnemonic, seed or private-key persistence.

Same credential + RP + salt + derivation yields the same address. Development is
not a separate wallet namespace. Use a separately created test passkey; fund only with testnet MON when deliberately
testing transfers.
Changing the RP or derivation requires a reviewed recovery/migration strategy.

## Modes and native validation

`npm start` selects `native` and opens the normal app using the Android replacement.
Unsupported platforms or missing native modules fail explicitly without a legacy
or mock fallback. Simulated passkey startup is no longer supported.
`npm run debug:stored-wallet` opens the isolated replacement diagnostic;
`npm run debug:ui` opens the UI playground. `native` is the only valid
passkey mode and defaults when the variable is omitted. See [README](../README.md)
for launch and rebuild instructions.

Configuration alone does not prove domain ownership, installed signing or provider
capability. Rebuild native clients after changing
native code or entitlements. No JavaScript PRF/signing fallback is permitted.

## Domain association deployment

The frontend owns `public/.well-known/apple-app-site-association` and
`public/.well-known/assetlinks.json`. Keep their approved app identities aligned
with the mobile configuration; preserve existing entries when adding identities.
Follow the [hosting guide](../../frontend/docs/PASSKEY_HOSTING.md) for deployment
and manual HTTP/header/content checks. No mobile script generates or publishes them.

For iOS, verify the hosted Apple file includes the configured Team ID and bundle ID.
For Android, verify the package and installed signing certificate fingerprint.
Successful HTTP checks do not establish signed-device or credential-provider support.
Rebuild native clients after changing signing configuration or entitlements.

## Acceptance

Functional tests mock external/native boundaries. Create/open/recovery, unsupported
PRF, cancellation, partial creation, wrong credentials and late callbacks need
provider-aware verification. Current evidence and remaining physical iOS/Android
cases are tracked in [signer verification](NATIVE_SIGNER_VERIFICATION.md).
No device test, hosting check or provisioning action was performed during this
documentation consolidation.

## iOS failure diagnostics

In Console, filter for subsystem `io.gizu.storedwallet`, category `ceremony`.
Each native call has a random attempt ID, operation, stage and classified error.
Use these to distinguish passkey presentation/verification, storage, backup and
lifecycle failures. Apple authorization failure alone does not prove a domain
association problem; check the signed identity and hosted association separately.

Logs exclude credentials, wallet identifiers, secrets, backup paths and raw error
descriptions. The access screen uses fixed messages for cancellation, timeout,
busy state and Apple passkey failure; unknown errors retain recovery guidance.
A cancelled or failed backup can be retried against the same stored wallet.
Native diagnostic changes require a rebuilt app.
