# Native signer verification

## 2026-09-25 — Checked persistence and journal retention

- Android arm64 debug build and all 32 native JVM tests passed. Added failure
  injection for sync/close, rename, directory sync and committed-byte verification;
  these paths assert no broadcast. Tests also cover cancelled-review compaction,
  count/byte-based archival, archive failure, active-write failure after archival
  and preserving unresolved signed records.
- Writes now use throwing sync/rename operations plus directory sync and read-back.
  Settled archives are encrypted local files outside the active Activity window.
- Documentation formatting and diff checks passed. No device install or device
  filesystem fault injection was performed; device acceptance of these changes
  remains pending. JavaScript and Rust code were unchanged and their suites were
  not rerun.

## 2026-09-25 — Migration phase 4 exact transfers and resume

- Android arm64 debug build and all 27 native JVM tests passed. New coverage
  includes encrypted journal restart, write failure before broadcast, cancellation
  after persistence, lost responses, identical-byte retry, pending/finalized
  reconciliation, nonce conflicts, stale revisions and numeric bridge normalization.
- All 206 Jest tests in 30 suites passed with coverage thresholds; 11 Rust tests
  passed. App functional tests exercise Withdraw, explicit resume, cancellation,
  stale revision recovery and nonce conflicts using mocked native responses.
- TypeScript, lint, formatting, local documentation links and diff checks passed.
  A final focused run passed all 12 transfer tests. Network-enabled Expo Doctor
  passed 20/21 checks; the remaining failure is an existing Expo patch mismatch
  (`57.0.24` installed, `~57.0.25` expected). No dependency upgrade was included.
- APK inspection found the replacement transfer activity/module/core and no
  retained signer module/core. Retained module source is unchanged.
- Installed the updated APK on the connected Android phone, preserving wallet
  data, and verified normal Home loaded through Metro. The user reported that
  the guided cancellation, withdrawal, restart/history and background/resume
  checks all worked. These are user-reported results, not instrumented assertions.
  Multi-step batches, lost-response identical-byte retries, device-lock/expiry
  and second-device recovery remain unverified on hardware. No security audit
  is claimed.

## 2026-09-25 — Migration phase 3 verified backup

- Android arm64 debug build and 18 native JVM tests passed. Tests cover backup
  roundtrip/tampering/wrong PRF, storage verification failures, healthy-wallet
  overwrite rejection and compatibility with phase-2 storage records.
- TypeScript, lint, formatting and diff checks passed. The full Jest coverage
  run passed 193 tests across 28 suites, including coverage thresholds. An added
  Account backup/retry scenario subsequently passed in the five-test focused
  onboarding/backup suite.
- APK inspection found the replacement backup activity/core and no retained
  signer module/core. Retained module source remains unchanged.
- Installed the phase-3 build on the connected Android phone and opened normal
  onboarding. The user reported the guided backup/onboarding checks worked,
  including the suggested Account backup and reconnect checks. This is
  user-reported acceptance, not instrumented verification. Screen-lock behavior
  and second-device restore remain unverified; no independent security review
  is claimed.
- Rust core was unchanged and not rerun; Expo Doctor and iOS checks were not run.
  Transfers/resume remain unimplemented for the replacement signer.

## 2026-09-25 — Migration phase 2 storage and authorization

- New Android module `GizuStoredSigner` and entropy-based Rust core built successfully.
- 11 Rust tests and Clippy passed; 12 Android JVM tests passed (credential
  verification, encryption integrity and wallet storage failure/restart behavior).
- TypeScript, formatting, lint and 21 focused app/access tests passed. Main-app
  access remains unavailable; no backup-required wallet can become an app session.
- Android arm64 APK built. APK inspection found replacement classes/core and no
  retained signer classes/core. Android autolinking includes only the replacement;
  Apple includes neither signer. Retained signer source is unchanged.
- Installed the phase 2 build and development harness on the connected Android
  phone. The user reported the guided create/open/cancel/restart checks worked.
  This is user-reported device evidence, not Keystore instrumentation or an
  independent security review. Backup PRF evaluation, recovery and transaction
  ceremonies remain unimplemented and unverified.
- Full app coverage/Expo Doctor were not rerun for this native-only increment;
  the prior phase's check results and network limitations are recorded below.

## 2026-09-25 — Migration phase 1 disconnection

- TypeScript, formatting, lint and diff checks passed.
- Full Jest coverage suite: 182 tests across 25 suites passed; coverage thresholds passed.
- Expo autolinking resolution excludes `gizu-signer` on Android and Apple.
- Offline Android arm64 debug build passed. APK inspection found neither retained
  signer DEX classes nor its native library. No device installation performed.
- Old signer native implementation/tests/build scripts unchanged; only its module
  README changed. Standalone native tests were not rerun for this disconnection.
- `npm run check` stopped at Expo Doctor: external Expo/React Native Directory
  metadata checks failed (including exp.host DNS lookup). Coverage ran separately.
- iOS rebuild, binary inspection and physical-device checks were not run.
- Replacement contracts are declared only; no stored-wallet runtime, backup or
  resume acceptance is claimed by these checks.

Consolidated 2026-09-24. Historical evidence below is carried from the N1–N3 records;
checks were not rerun for this documentation change. Counts describe those revisions,
not a claim about current test totals. The [architecture](NATIVE_SIGNER.md) defines
the boundary; the [roadmap](../PLAN.md) owns scheduling. Setup commands live in
[README](../README.md).

## Recorded automated evidence

| Slice, 2026-09-24    | Recorded checks                                                                                                                                                                     | Scope limitation                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| N1                   | 4 Rust tests, formatting/Clippy, independent viem recovery of 16 synthetic signatures, 123 Jest tests/15 suites, coverage, TS/lint, Android arm64 and unsigned iOS simulator builds | No physical iOS, secret-boundary instrumentation or audit                         |
| N2                   | 10 Rust tests, synthetic EIP-1559 decoding/hash/signer checks, 138 Jest tests/17 suites, coverage and both builds                                                                   | Native review implemented; hostile-bridge acceptance incomplete                   |
| N2 follow-up         | 12 Rust tests, 8 Android JVM tests, 25 focused Jest tests, TS/scoped lint, arm64 APK                                                                                                | Transport/funding/cancellation checks; no new iOS or 13-transfer acceptance       |
| N3 access            | 13 Rust tests, 157 Jest tests/19 suites, coverage, native bindings, Android JVM/build and unsigned iOS simulator                                                                    | Mocked access tests do not establish provider behavior                            |
| N3 transfers/history | 14 Rust tests, 170 Jest tests/21 suites, coverage, TS/lint/format, Android JVM/build and unsigned iOS simulator                                                                     | Live approval through the newly integrated screen not established by installation |

Synthetic checks use reference inputs only, never real passkey secrets in JS.
The transfer vector example and `scripts/verify-transfer.mjs` independently decode
and recover native outputs. CI native generation/build configuration exists;
local results do not establish hosted CI/Linux success. CI's ephemeral Android
signing key must not be published in domain associations.

Previously recorded failure: Expo Doctor 20/21, installed Expo 57.0.24 versus
expected 57.0.25. This is historical until rerun, not a newly observed result.

## Physical Android evidence

N1 user reported success on A142 / Android 16. Provider identity, exact revision,
prompt count and boundary instrumentation were not fully recorded.

N2 user completed a 0.001 MON transfer after funding Account 0. Historical read-only
RPC checks confirmed successful receipt, chain 10143, 21,000 gas and a block below
the finalized head:

- Sender: `0x90ad2f19302ED5439B69659Bbc5D6d8c5b7dDf95`
- Recipient: `0x0e4e77B43a94A704E2a7a005238038F3EF00f407`
- Hash: `0xb3b9b115ec88086227c30cb712ba832b3604b2baaae771d9b70bf1b4ddbe9cb6`

User reported one unlock and one native approval for two further 0.001 MON transfers.
Historical RPC checks confirmed the same sender/recipient and consecutive nonces 1, 2:

- `0x6f67dafae7bb847dae6e6a1c6ebda51947fc98eccfc46e0c83028962252eee97`
- `0x1bd53bddc7b452dac29f69ce1de2ab5e9ad357275d11dd84bf942ed090602bdb`

User reported three finalized records after reopening and still three after
cancelling before approval. This supports completed-record persistence and one
cancellation case, not process-death safety during uncertain submission.
N3 screenshots showed a different zero-balance account and recovery of the funded
Account 0 with 19.990574 testnet MON: Android access/balance evidence only.

Earlier 2026-09-23 JavaScript-probe success proved derivation/recovery/test signing
on one provider; it does not prove the replacement native secret boundary.

## Main-app integration evidence

Existing Home, Account, Deposit/Withdraw and Activity use native adapters. Functional
coverage mocks those boundaries and exercises validation, duplicate prevention,
status display, missing legacy details, refresh failure, leaving a page during an
operation, disconnect and stale results. Native-only signing policy is unchanged.
Main-app physical acceptance remains outstanding; debug-harness evidence does not
complete it. Installation/build success is not an accepted live journey.

## Remaining acceptance

Manual testing was paused by the user. Do not resume transactions or mark skipped
cases passed as part of documentation work.

- Physical iOS PRF create/open/recovery, review, cancellation and provider behavior.
- Android provider/device/revision/prompt record and native synthetic-secret
  instrumentation across returns, events, errors, logs and generated bindings.
- Hostile JS: removed bridge/secret exports inaccessible; no approve bypass, altered
  chain/recipient/value/fees/index, extra steps, replay, expiry or concurrent escalation.
- Review accessibility, overlay/touch protections, provider pauses versus background,
  teardown and late callbacks on both platforms.
- 13-transfer one-unlock batch: not run. Synthetic 16-signature proof is different.
- Partial-batch cancellation and uncertain-submission restart: not run. Preserve
  already-broadcast hashes, stop remaining authority, reconcile without resending.
- Insufficient funds on an unfunded account: explicit device acceptance still open.
- Independent FFI/memory/dependency/license/update-trust review and security audit.
- Signed production builds, recovery/domain loss/account discovery, web isolation
  and privacy decisions before real-funds release.

Record future results with revision, device/OS/provider, build type, prompts and
public hashes/statuses. Never capture real credential secrets or heap dumps.
