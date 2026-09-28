# Stored-wallet Android signer

Phases 2–4 implement a separate local Expo module, `GizuStoredSigner`, under native
package `io.gizu.storedwallet`. The retained `gizu-signer` module is unchanged and
excluded from app linking. This module is Android-only and development-only.

## Implemented boundary

- Native `createWallet` requires a native confirmation and Credential Manager
  registration. Registration is verified against challenge, origin, RP and P-256
  credential metadata. PRF-enabled registration is required for later recovery.
- Random 32-byte entropy is generated only after the provider returns to a focused,
  unlocked app. Rust derives all 16 public accounts to check core availability.
- `WalletStore` encrypts a bounded binary record using AES-256-GCM, application-bound
  AAD and an Android Keystore key. Entropy is not encoded into JSON or strings.
  Checked file sync, atomic rename, directory sync and read-back commit writes in
  `noBackupFilesDir`. Legacy AtomicFile backups remain readable. Missing key/corruption produces
  `recoveryRequired`; existing data is never overwritten by creation.
- The Keystore key does not require user authentication: passkey authorization is
  enforced by native code, not secure hardware. Native memory compromise is outside
  this boundary. Managed/provider/FFI copies cannot be promised forensic erasure.
- `openWallet` verifies a fresh signed assertion, bound to the wallet and open
  purpose. Decrypted entropy is cleared before waiting for credential UI. Opening
  does not establish reusable spending authority or backend authentication.
- A process-wide mutex serializes ceremonies. Lock, teardown, cancellation and the
  two-minute timeout invalidate work. Only bounded credential-provider and document-picker waits can
  survive an activity pause; foreground and unlocked state are required on return.
- Native responses are explicit public maps. Errors are fixed messages without
  underlying provider, key, file or crypto details. A cancellation after an atomic
  write may leave a valid backup-required wallet; query state rather than recreate.

## Verified backup and app access

`backupWallet` saves an encrypted file through Android's document picker, then
requires reopening it and a fresh passkey PRF check. It compares wallet identity,
entropy and all 16 accounts before marking `ready`. Cancellation keeps the same
backup-required wallet; ready wallets remain ready when a later backup is cancelled.
`restoreWallet` requires the file and original passkey and only accepts absent or
unreadable local storage. It never overwrites a healthy wallet. No file paths or
contents cross Expo. See [backup format and lifecycle](../../docs/NATIVE_SIGNER.md).

Native capabilities report storage/access/backup/transfers eligibility in Android
development builds. The app gates entry on `ready`; Account offers backup management.
Withdraw and Activity use native exact-transfer review, passkey authorization and
an encrypted operation journal. Signed bytes are saved before broadcast; refresh
only reconciles. Explicit resume requires fresh authorization and retries saved
transactions byte-for-byte. Unsigned cancellations are compacted; when the active
journal fills, settled records are encrypted and durably archived before removal.
Unresolved signed records remain active. Activity shows the active window, not local
archive files. Restore starts a new journal generation. The explicit
`npm run debug:stored-wallet` harness remains available, with no legacy fallback.
Guided phase-4 phone checks were user-reported successful; extended failure-path
acceptance remains pending.

## Ownership and verification

- `core/`: adapted derivation and exact-transfer policy from the retained Rust core,
  now consuming random wallet entropy. No fixed-message probe exports. Native-only
  UniFFI bindings are not a JavaScript signing API.
- `android/`: Expo lifecycle, native prompts, credential verification and storage.
  `rpc/` owns bounded Monad transport; `transfers/` owns operation persistence,
  reconciliation, exact-transfer orchestration and native review.
- `scripts/build.sh`: generates Kotlin bindings and the arm64 Android library.
- Generated bindings, targets and binaries are ignored; never edit them manually.

From `mobile/`:

```sh
npm run stored-signer:test
npm run stored-signer:build
cd android
./gradlew :gizu-stored-signer:testDebugUnitTest :app:assembleDebug
```

The build needs Rust 1.94.1, the aarch64-linux-android target, Android NDK
27.1.12297006 and a macOS/Linux host. The JVM tests exercise storage failures,
AES-GCM integrity and passkey verification using synthetic data; they do not prove
Android Keystore behavior or physical-device/provider support.

The prototype supplied the starting credential verifier/envelope and their tests.
The crypto core retains the original pinned Rust dependencies. Android adds CBOR
4.5.6 for parsing authenticator registration data and uses existing OkHttp 4.9.2
for Monad RPC; no wallet secrets go through JS.
