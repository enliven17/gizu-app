# Earn preview optimization implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline, then obtain one fresh-context review.

**Goal:** Reuse Swap's indicative preview and conservative fee convergence in the existing native Earn journey, preserving its two fresh wallets and exact 10/90 split.

**Architecture:** Keep the existing coordinator, signing engines, source planner, encrypted journals and UI. Publish a strictly non-authorizing indicative snapshot while precise fees are prepared. Conservatively retain the largest observed fee caps rather than chase smaller fluctuations; refresh aging payout/vault previews before presenting final terms. Final approval still binds exact native limits, and executable steps still recheck fresh terms.

**Tech stack:** TypeScript/viem/Pimlico backend; Kotlin/OkHttp native Android; React Native/TypeScript functional tests.

**Spec:** The user's approved request to reuse Swap optimizations while retaining 10/90, and the existing invariants in `docs/internal/CONFIDENTIAL_EARN.md`.

## Global constraints

- Keep two fresh destination wallets and split verified confidential credit exactly 10/90, including multi-source rounding.
- No keys or complete ownership graph leave the device. No mocked balances, fees or shares.
- No signature or mainnet transaction during implementation/verification.
- No new UI component or parallel coordinator; no automatic withdrawal.
- Preserve fee collector qualification, operation-authenticated settlement, immutable signed children, reservations and the 15-minute single-passkey scope.
- An indicative snapshot cannot authorize spending. Confirm becomes available only for fresh complete native review limits.
- Keep old saved journals and bridge contracts valid. Changes to public snapshots are additive.
- Do not push or deploy. Install the standalone Render-targeted APK preserving device data.

## Review focus

- Fluctuating provider fees must converge conservatively without exceeding the budget or understating the withdrawal reserve.
- Long preparation must refresh real quote expiry, never extend expired provider validity by relabeling time.
- A changed payout minimum must be reflected in vault economics before final review.
- Concurrent progress reads must never admit a second signing ceremony or survive cancellation/session change.
- Background/cancel during preparation must release unsigned reservations and prevent stale UI success or signing.

## Task 1: Conservative fee convergence

Files: `backend/src/adapters/earn/robinhood-deposit-planner.ts`, `backend/test/adapters/earn/robinhood-planner.test.ts`.

- [ ] Write/run RED regression for alternating measured fee caps; require maximum observed caps with unchanged 105% deposit/260% withdrawal math.
- [ ] Retain maximum observed deposit/redemption caps across attempts. Final measured cap must remain within the budget; preserve all simulation and state checks.
- [ ] Test unbounded increases/final-cap overflow and simulation failures still fail closed.
- [ ] Run affected tests, backend typecheck/build and full suite; commit.

## Task 2: Native indicative progress and fresh final review

Files: existing `EarnDepositPreparer.kt`, `EarnDepositJournal.kt`, `EarnDepositGateway.kt`, `EarnDepositRemaining.kt`, `NativeRpcTransport.kt`, and their native tests.

- [ ] RED regressions for early indicative publication (no authorizing review), overlapping hold/invest quotes, aging real quotes and changed minima.
- [ ] Publish only known verified indicative amounts on the preparing journal; no proposed fees/shares until measured.
- [ ] Parallelize independent hold/invest reads. Bound fresh-preview refresh attempts and update minima before any final vault computation.
- [ ] Timestamp final review when complete while retaining the earliest real expiry; never renew provider lifetimes locally.
- [ ] Allow the read-only vault calculation up to 60 seconds (70-second overall call), retaining expiry checks and ordinary RPC limits.
- [ ] Keep remaining/signed-child recovery compatible. Native assertions prove no approval from a partial preview.
- [ ] Run native tests and build; commit.

## Task 3: Existing page renders preparation progress

Files: existing native bridge/read queue, `mobile/src/domain/earn/depositJourney.ts`, `useDepositJourney.ts`, `DepositJourneyScreen.tsx`, functional/service tests.

- [ ] RED functional regression for indicative split while precise preparation is pending; Confirm disabled.
- [ ] Decode additive public indicative fields strictly. Permit only the existing native deposit status read concurrently; keep all spending mutations serialized and cancellation-generation checks intact.
- [ ] Poll status during preparation with session/lifecycle guards and backoff. Show indicative split on the existing page and clear it when budget/session changes.
- [ ] Verify final review/one confirmation, stale cancellation, malformed data and old snapshots.
- [ ] Run mobile typecheck and affected functional suites; commit.

## Task 4: Verification and delivery

- [ ] Live read-only profile the same diagnostic input against the owned RPC; report stage timings and convergence counts without claiming a guaranteed speedup.
- [ ] Run complete affected backend/Android/mobile checks. Obtain one independent fresh-context final review and fix material findings with RED/GREEN tests.
- [ ] Update relevant internal docs with actual results and limitations.
- [ ] Build/install/open standalone APK against Render; no approval/signing automated.
- [ ] Report commits, required backend deployment and pending funded device test accurately.
