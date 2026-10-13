# Earn without history implementation plan

**Goal:** Remove the invitation-only Aurora history dependency from new native Earn investments and qualify the observed zero-integrator-fee routes.

**Design approved in chat:** Native code saves a read-authenticated confidential balance baseline before sending each funding operation. It waits for the exact saved route to succeed and checks the resulting credit against its quote bounds. Funding is sequential; missing or ambiguous evidence pauses spending. Public payouts require the saved intent, successful route, and an exact finalized token transfer receipt. Private keys and operation ownership remain on-device; existing bounded passkey authority and journals remain the owners of signing/recovery.

**Architecture:** Extend the existing settlement adapter with server-sealed balance snapshots and portable credit attestations using the existing recovery key. Keep legacy history reconciliation for old journals without a baseline. New payouts use portable credit evidence after funding; no repeat balance attribution after funds have been spent. Use the inspected portal zero-integrator setting plus explicit observed fee/referral allowlists, without claiming knowledge of collector beneficiaries.

**Execution:** Native, in this session; user explicitly instructed implementation and will configure Alchemy on Render. No deployment or mainnet spending.

## Tasks

- [x] Fee policy: add a checked-in Robinhood lifecycle policy accepting the two observed referrals, bounded collectors and zero application charges; keep explicit environment overrides. Test known quotes and reject increases/unknown identities.
- [x] Settlement: issue authenticated balance baselines and sealed credit attestations; check owner, route, quote, baseline and credit limits; test absent history access, tampering, stale snapshots, ambiguous deltas and restart.
- [x] Native funding: persist baselines before durable spending signatures; stop sequential funding until each source is credited; retain saved attestations and reuse them for both payout legs. Test multi-source waiting and recovery.
- [x] Payouts: reconcile saved signed intents through status and finalized token receipts; remove history reads for new attestations while retaining legacy compatibility. Test wrong/ambiguous receipts and uncertain submissions.
- [x] Verify backend, Android and applicable core checks; update deployment/recovery documentation and report exact limitations.

## Review focus

- A pending first source must prevent the second from signing.
- A balance delta is bounded by the saved quote; unrelated/excess funds must not become investment credit.
- Reconciliation after payouts must retain the original credit, not reattribute a reduced balance.
- Shared destination addresses in a funding batch must accept distinct finalized receipts while rejecting duplicate receipt use.
- Old signed journals must not be re-signed or silently treated as newly verified balance-based operations.

## Ledger

- Initial repository clean on `fix/vault-signing`, base `8825de1`.
- LOR and Context7 tools are unavailable in this session; inspected local native guidance and official Aurora/Robinhood documentation instead.
- Ruling: preserve legacy history adapter for already signed operations without snapshots. It may remain unavailable without invitation; guessing a historical baseline could spend unrelated funds.
- Ruling: portal zero-fee configuration establishes the configured Gizu fee, not collector ownership. The policy names observed service charges and bounds them without asserting collector beneficiary identity.

- Ruling: add a distinct native `earnBalanceDeltaSettlement` capability. Older APKs already advertise guided deposits, so that older flag cannot establish snapshot support.
- Ruling: perform private baseline reads before reconstructing final public signing state. This preserves Rust's 15-second freshness requirement despite provider latency.
- Final review: fresh reviewer confirmed binding/capability/return fixes and found no remaining blocker; independently ran 56 focused backend tests.
- Verification: 238 backend tests passed, 3 optional fork tests skipped; backend typecheck/build passed. 279 Android signer tests and standalone release APK passed. Mobile typecheck, 272 functional tests and 33 focused service/iOS capability tests passed. After final capability changes, 9 affected return/withdrawal functional tests also passed. Live empty diagnostic account returned a sealed zero-balance baseline; live dry source quote returned no fee/settlement blockers. No asset-transfer intent or mainnet spending transaction sent.
- Release boundary: user configures Alchemy; backend deployment and phone installation remain external steps. ADB detects no phone. Full funded vault test requires the owned RPC, matching deploy/APK, and explicit user spending approval.
- Ruling: recovered unsigned legacy quotes must also pass snapshot admission; a regression demonstrated and closed a quote-binding bypass. Already signed legacy operations retain exact-byte recovery.
