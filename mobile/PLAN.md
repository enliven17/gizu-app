# Gizu mobile roadmap

Updated 2026-09-25. One active implementation roadmap. Completed work is summarized
below; implementation does not imply device/security acceptance. Setup belongs in
[README](README.md), product behavior in [parity](docs/PARITY.md), native contracts
in [signer architecture](docs/NATIVE_SIGNER.md), and evidence in
[signer verification](docs/NATIVE_SIGNER_VERIFICATION.md).

## Current implementation

| Area                  | Implemented                                                                                                             | Remaining boundary                                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Foundation (M0–M1)    | Expo development builds, React Navigation, npm, strict TypeScript, NativeWind, atomic UI, Jest/RNTL                     | Windows checks, root just recipes, EAS/release configuration           |
| Product UI (M2–M5)    | Welcome/access, Home, Vaults, Swap placeholder, transaction flows, Account and notifications                            | Investment/notification behavior uses fixtures in explicit demo mode   |
| Native signer (N0–N3) | Native PRF retrieval, shared Rust derivation/policy, native approval, bounded Monad testnet transfers, outgoing journal | Adversarial/lifecycle/provider acceptance and independent review       |
| Main app (M6.1a–d)    | Native passkey access, Account 0 MON balance, address/copy, Deposit/Withdraw and Activity in existing routes            | Main-app physical acceptance; incoming/external history is not indexed |
| Structure             | Hidden developer harnesses; wallet domain/adapters; native RPC, storage and transfer folders                            | Further decomposition only where it improves ownership/testing         |

`npm start` uses native access only. Fixtures remain in tests and UI previews. No separate
wallet product screen, new wallet tab or mock financial fallback for real sessions.
See [capabilities and accepted UI decisions](docs/PARITY.md).

## Next work — Android stored-wallet signer migration

Follow the agreed [signer migration plan](docs/SIGNER_MIGRATION.md): replace
PRF-derived wallets with locally encrypted random entropy, reuse the Rust core,
require verified onboarding backups and add explicitly authorized operation resume.
This migration targets Android only and fresh development wallets; iOS signing
will be unavailable until its replacement is implemented. Phase 1 disconnects the
old signer and declares the replacement contract. Phase 2 implements isolated
Android encrypted storage and native passkey create/open. Phase 3 connects access
to native save/reopen backup verification, recovery and Account backup management.
Only verified wallets enter Home. Phase 4 connects Withdraw and Activity to native
exact-transfer approval, encrypted operation history and explicit resume. Next is
phase 5: device acceptance and retained-module isolation checks. Phase-3 guided
checks were user-reported successful; second-device restore and extended phase-4 failure-path
acceptance remain pending. Guided phase-4 phone checks were user-reported successful. The table above
summarizes the previous implementation, not current signer availability.
Preserve the existing Gizu signer module for future reuse, but disconnect its app
wiring and exclude it from app native builds. Only the replacement will be active.

## Follow-up — M6.1e acceptance and integration quality

- [ ] Verify normal native entry, protected/deep-link routing, Home, Account,
      Deposit/Withdraw and Activity together on supported physical devices.
- [ ] Verify late results cannot cross sessions; page navigation preserves pending
      operations, while disconnect cancels remaining native authority.
- [ ] Reconcile existing automated coverage with those journeys; distinguish mocked
      behavior from native/provider evidence.
- [ ] Resolve the recorded Expo patch-alignment warning through a separate verified
      dependency update, not by silently changing versions during other work.
- [ ] Complete accessibility, small-display, large-text, reduced-motion, keyboard,
      offline/startup and native dismissal checks.

Previously paused manual tests remain paused. A documentation update or successful
build does not complete them. The exact open signer cases live in the verification
record rather than a second milestone checklist here.

## Structural improvements

- [ ] Assess typed transfer phases/errors so cancellation, funding, RPC failure and
      uncertain submission produce distinct actionable feedback.
- [ ] Design journal capacity/versioning and completed-record retention; never
      remove unresolved evidence or introduce automatic resend.
- [ ] Separate credential/lifecycle orchestration from native presentation in small
      behavior-preserving changes, retaining the existing native/core authority.
- [ ] Check product-to-development import boundaries and release bundle/native
      debug gates; hiding screens is not proof of code exclusion.
- [ ] Consider shared native theme generation and deterministic device/Metro startup
      after their scope is agreed. These are opportunities, not claimed defects.

Keep one session-scoped owner for transfers and balance refresh. Do not introduce
pass-through wrappers, a second live ledger or a generic JavaScript signer.

## Deferred integrations and product decisions

- Incoming/external transaction indexing: deferred at the user's request; no
  provider selected and no implementation underway.
- Real vault catalog, positions, quotes, orders and investment contracts: require
  authoritative service contracts before enabling actions in native mode.
- Notifications, support, statements, profile/backend authentication and real
  request-access submission: demo/local behavior is not a backend integration.
- Encrypted backup plus original-passkey recovery is included in the signer
  migration. Independent recovery, lost-passkey/domain/provider recovery and
  multi-account discovery require further design and acceptance before real funds.
- Wider native account/asset/chain scope, ERC-4337 and privacy guarantees: separate
  decisions; no claim that derived accounts are publicly unlinkable.
- Preserve existing visual design when integrating services. Restore unavailable
  capabilities only with truthful data and explicit action guards.

## Release readiness — M7 / N4

- [ ] Complete the open [native security and device acceptance](docs/NATIVE_SIGNER_VERIFICATION.md#remaining-acceptance).
- [ ] Independently review signer, native review, FFI copies, dependency/license
      obligations, update provenance and redacted release diagnostics.
- [ ] Resolve production identifiers, signing, domain associations, Expo/EAS ownership
      and development/preview/production build profiles. Production remains blocked.
- [ ] Verify signed release builds on supported physical iOS and Android devices.
- [ ] Finalize recovery/support/privacy/distribution requirements, rollback strategy
      and font redistribution rights; system fonts remain the fallback.
- [ ] Add root just recipes delegating to app npm scripts and verify Windows and
      macOS/Linux prerequisites when this previously deferred tooling work resumes.

## Verification rules

Run checks appropriate to the change, using package scripts as the command source
of truth. Main mobile check: `npm run check`; focused functional runs:
`npm run test:functional -- <file>`. Native changes additionally need core tests,
platform tests and builds. Report passed, failed, blocked and not-run separately.

Keep dated evidence with its scope and revision when known. No new tests, live
transactions or production approval are implied by this roadmap consolidation.
