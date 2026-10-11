# Confidential Deposit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver a clean vault deposit journey that creates two fresh destination wallets and invests the 90% leg through confidential routing, with one bounded passkey approval on the normal Android Robinhood path.

**Architecture:** A native coordinator owns preparation, approval, child execution and recovery. A typed React Native controller displays public snapshots from that coordinator. Existing funding selection, reservations, native signing engines and journals remain authoritative; new read-only previews are separate from executable plans.

**Tech Stack:** React Native/Expo, TypeScript, Kotlin/coroutines, existing Rust/UniFFI signer, Swift capability guards, Fastify/Zod, viem and isolated Anvil simulation. No new package dependency is planned.

**Spec:** [Approved confidential deposit design](../specs/2026-10-11-confidential-deposit-design.md). The user approved the flow and requested this plan on 2026-10-11.

## Global Constraints

- Branch: `fix/backend-deposits`; preserve all existing uncommitted backend URL changes.
- Hosted backend: `https://gizu-app.onrender.com`; release builds never use the USB backend.
- Source: Monad mainnet USDC, chain `143`; Robinhood USDG destination chain `4663`.
- USDG token: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`; Steakhouse vault: `0xBeEff033F34C046626B8D0A041844C5d1A5409dd`.
- Source margin: `0.01 USDC`; reuse current per-source budgeting and rounding rules.
- Split: `hold = floor(totalCredit / 10)`; `invest = totalCredit - hold`, using authenticated operation-specific credit and existing cumulative offsets.
- Robinhood fee policy: `10% fee-price headroom`, `5% operation-budget headroom`, `2.6-times simulated withdrawal reserve`.
- One foreground deposit grant lasts no more than `15 minutes`; individual quotes retain their shorter validity limits.
- Exactly two fresh destination wallets per new investment; editing/reopening an unsigned draft reuses its pair.
- Separate child transactions, signatures and recovery journals; no joint destination transaction, wallet-to-wallet transfer, unrestricted signer, new application fee or common collector.
- Complete account ownership and relationships stay encrypted on the device; no secrets enter JavaScript or backend storage.
- Stop at verified investment. Live withdrawal and return require a separate user request and approval.
- Keep Ethereum execution and legacy journals available, with truthful platform capability checks. Do not advertise the new single-approval path where it is unsupported.
- Never uninstall the phone app, clear its storage or regenerate its Android identity/keystore. No mainnet spending without specific user authorization.

## Review Focus

1. Editing the amount while preparation returns: stale quotes must not replace the latest draft or authorize a different budget (Tasks 6 and 7).
2. A passkey credential window briefly removes focus: legitimate approval must finish, but locking or genuinely backgrounding the app must revoke authority (Task 5).
3. The second source settles before the first, with odd credit atoms: no payout starts early and total hold allocation remains exactly `floor(totalCredit / 10)` (Task 4).
4. A process dies between durable signing and receipt persistence: recovery must find the existing child, preserve reservations and avoid a second spend (Tasks 3 and 4).
5. The app updates ahead of Render, or a restored wallet lacks local child history: show unavailable/recovery states before new spending, without old forecasts or silently allocating another cycle (Tasks 4, 6 and 8).

## File and interface map

All paths below are relative to the repository root. Kotlin source/test paths use these abbreviations:

- `K`: `mobile/modules/gizu-stored-signer/android/src/main/java/io/gizu/storedwallet`
- `KT`: `mobile/modules/gizu-stored-signer/android/src/test/java/io/gizu/storedwallet`

| Unit                 | Files                                                                                                      | Responsibility                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Public contract      | `mobile/src/domain/earn/depositJourney.ts`; `mobile/src/domain/wallet/storedSigner.ts`                     | Strict public snapshots, preview limits, actions and capability contract               |
| Backend previews     | `backend/src/adapters/earn/robinhood-deposit-preview.ts`; `backend/src/http/routes/earn-preview.routes.ts` | Prospective route/deposit estimates, isolated simulation, no executable payload        |
| Native grant         | `K/earn/EarnDepositApproval.kt`                                                                            | Bound passkey authority, freshness, per-stage budgets and exact prepared-review checks |
| Native persistence   | `K/earn/EarnDepositJournal.kt`                                                                             | Draft identity, review revision, child references, restart recovery                    |
| Native preparation   | `K/earn/EarnDepositPreparer.kt`; `K/earn/EarnDepositGateway.kt`                                            | Source selection/reservations and individual preview requests                          |
| Native execution     | `K/earn/EarnDepositCoordinator.kt`; `K/earn/EarnDepositEngineAdapter.kt`                                   | Ordered engine calls, grant enforcement and reconciliation                             |
| Native UI bridge     | `K/earn/EarnDepositHost.kt`; `K/GizuStoredSignerModule.kt`                                                 | One native review/passkey, exclusive execution ownership and lifecycle hooks           |
| App orchestration    | `mobile/src/services/earn/depositJourney.ts`; `mobile/src/features/earn/useDepositJourney.ts`              | Typed bridge decoding, request revisions, bounded status polling                       |
| Deposit presentation | `mobile/src/features/earn/DepositJourneyScreen.tsx`; `mobile/src/features/earn/EarnScreen.tsx`             | Amount/review/progress/result with existing UI primitives                              |
| Saved investment     | `mobile/src/features/earn/EarnInvestmentScreen.tsx`; existing execution panels and navigation              | Existing cycles, details, withdrawal and recovery controls                             |

Existing engines keep their semantic checks. The new adapter joins their prepared-review authority callbacks; it does not copy their signing logic. Introduce no shared UI primitive unless an existing primitive cannot express the approved layout.

## Task 1: Define and test the public deposit contract

**Files:** Create `mobile/src/domain/earn/depositJourney.ts`, `mobile/tests/unit/earn/depositJourney.test.ts`; modify `mobile/src/domain/wallet/storedSigner.ts`.

**Interfaces:** Export `DepositPhase = 'draft' | 'preparing' | 'review' | 'authorizing' | 'funding' | 'settlingCredit' | 'payouts' | 'depositing' | 'paused' | 'invested'`. Export `DepositSnapshot` with `journeyId`, `revision`, `walletId`, `intentId`, `profileId`, `phase`, public destinations, settled amounts, completed steps, optional review and typed pause reason. Atom amounts are canonical uint256 decimal strings. `DepositReview` contains source budget/caps, each child's hold/invest minimum and fee cap, aggregate minimum vault assets/shares, reserve, policy/reference bindings and `expiresAtMs`; estimates and mandatory bounds are distinct.

Export `parseDepositSnapshot(raw: unknown, owner: EarnOwner): DepositSnapshot`, `canConfirmDeposit(snapshot: DepositSnapshot, nowMs: number): boolean` and `EarnDepositService` with `available(): Promise<boolean>`, `prepare(owner, profileId, budgetAtoms, draftId?): Promise<DepositSnapshot>`, `confirm(owner, journeyId, revision): Promise<DepositSnapshot>`, `status(owner, journeyId): Promise<DepositSnapshot>`, `resume(owner, journeyId, revision): Promise<DepositSnapshot>`, `cancel(owner, journeyId, revision): Promise<DepositSnapshot>`. `cancel` revokes local authority; it does not promise to undo submitted operations. These service methods are Task 6's contract. Status parsing preserves an expired saved review; `canConfirmDeposit` prevents confirming it.

- [x] Write `rejectsChangedOwnerAndDestination`, `rejectsNoncanonicalAmounts`, `preservesExpiredReviewButDisablesConfirm`, and `rejectsMissingMinimums` tests. Assert malformed membership/amounts fail, expired status still loads while `canConfirmDeposit` is false, and `unavailable` never parses as zero.

  ```ts
  expect(
    canConfirmDeposit(
      expiredReviewSnapshot,
      expiredReviewSnapshot.review!.expiresAtMs,
    ),
  ).toBe(false);
  expect(() =>
    parseDepositSnapshot(changedDestinationSnapshot, owner),
  ).toThrow();
  ```

- [x] Run `cd mobile && npm test -- tests/unit/earn/depositJourney.test.ts`; expect failure because the contract is absent.
- [x] Implement the tagged snapshot/review types and strict parser. Add optional `earnDepositJourney` capability and exact native methods: `prepareEarnDeposit(walletId, profileId, budgetAtoms, draftId)`, `confirmEarnDeposit(walletId, journeyId, revision)`, `getEarnDepositStatus(walletId, journeyId)`, `resumeEarnDeposit(walletId, journeyId, revision)`, `cancelEarnDeposit(walletId, journeyId, revision)`; native return values stay `unknown` until parsed.
- [x] Run that test and `npm run typecheck`; expect pass. Existing capability absence defaults to false.
- [x] Commit the contract and tests as `feat: define guided deposit contract`.

## Task 2: Add isolated previews for unfunded USDG destinations

**Files:** Create `backend/src/adapters/earn/robinhood-deposit-preview.ts`, `backend/src/http/routes/earn-preview.routes.ts`, `backend/test/adapters/earn/robinhood-preview.test.ts`, `backend/test/http/earn-preview.routes.test.ts`; modify `backend/src/app.ts`, `backend/src/adapters/earn/robinhood-simulation.ts`. Reuse `backend/src/adapters/earn/private-payout.ts`, `robinhood-paymaster.ts`, `policy.ts` and existing Aurora quote adapters.

**Interfaces:** `RobinhoodDepositPreviewPlanner.preview({owner, expectedUsdgAtoms, operationId, revision}): Promise<RobinhoodDepositPreview>`. Add `POST /v1/earn/robinhood/deposit-preview` for this input and `POST /v1/earn/native/payout/preview` for one `{profileChainId: 4663, confidentialAccount, recipient, amountAtoms, operationId, revision, leg}`. The payout preview obtains indicative quote output and qualified fee proof without authenticated-credit assertions, signed intents, submitted funds or durable execution recovery envelopes. Both responses carry `kind: 'preview'`, `readOnly: true`, `executionAvailable: false`, observed/expiry times, immutable request/reference bindings and explicit assumptions. They contain no calldata or UserOperation. Return `503 EARN_DEPOSIT_PREVIEW_UNAVAILABLE` when dependencies/fresh safe economics are unavailable.

- [x] Write failing tests for an unfunded owner, route unavailable, too-small hold leg, stale provider data, unqualified fees, changed contracts and request overflow. Assert routes never invoke submit/sign/authenticated-settlement methods or return executable bytes. The existing real-balance planner still rejects an unfunded owner.

  ```ts
  assert.equal(preview.readOnly, true);
  assert.equal(preview.executionAvailable, false);
  assert.equal("operation" in preview, false);
  assert.equal("calldata" in preview, false);
  ```

- [x] Run `cd backend && node --experimental-transform-types --test test/adapters/earn/robinhood-preview.test.ts test/http/earn-preview.routes.test.ts`; expect missing-preview failures.
- [x] Implement the separate preview planner and strict routes with `Cache-Control: no-store`, bounded bodies, silent identity-sensitive request logging and the existing provider error conventions. Prospective simulation may override only the verified USDG balance storage for this owner inside the pinned isolated fork; verify the overridden balance before calls. Discover and verify storage through the current fork/debug simulation tooling; fail closed if the token layout cannot be proved. Do not guess an ERC-20 slot or weaken `simulateRobinhoodDeposit`'s real funded-state path. Reuse fee headroom and reserve calculations; a hypothetical override never enters an executable result. Register routes in `backend/src/app.ts`.
- [x] Run the new tests plus existing `robinhood-planner.test.ts`, `robinhood-policy.test.ts`, `earn-planning.routes.test.ts`, then `npm run typecheck`. Run prospective isolated-fork evidence only when a usable RPC is available; report it separately.
- [x] Commit as `feat: preview confidential deposit economics before funding`.

## Task 3: Implement the native grant and durable journey record

**Files:** Create `K/earn/EarnDepositApproval.kt`, `K/earn/EarnDepositJournal.kt`, `KT/EarnDepositApprovalTest.kt`, `KT/EarnDepositJournalTest.kt`; reference `EarnFundingBatchApproval.kt`, `EarnSponsoredJournal.kt`, `EarnPayoutJournal.kt` and `FundingReservations.kt`.

**Interfaces:** `EarnDepositJournal.loadOrCreate(record: WalletRecord, profile: Int, draftId: String?): JSONObject`, `saveReview(id: String, revision: Int, review: JSONObject): JSONObject`, `attachChild(id: String, revision: Int, stage: String, childId: String): JSONObject`, `publicSnapshot(id: String): Map<String, Any>`. Store encrypted records using the current native storage conventions; expose only Task 1 fields.

`EarnDepositApproval.fromReview(record: WalletRecord, review: JSONObject): EarnDepositApproval`, `approveAfterPasskey(now: Long)`, `assertPrepared(record: WalletRecord, stage: String, child: JSONObject, preparedReview: JSONObject, now: Long)`, `recordDurableSignature(stage: String, childId: String, signedHash: String)`, `invalidate()`. Bind wallet/generation/cycle/role registry, source reservation membership, fixed destinations/profile/contracts, explicit limits and stage dependencies. Keep the active grant memory-only; persisted approval metadata is evidence, never authority.

- [x] Write failing tests for grant expiry at `900000 ms`, backwards time, wrong generation/cycle/source/vault/token, fee excess, below-minimum payouts/assets/shares, changed split, forbidden withdrawal/return and duplicate budget consumption. Assert a signed child's unchanged hash can be revisited without consuming its budget again; a replacement hash fails.

  ```kotlin
  grant.approveAfterPasskey(1_000L)
  grant.assertPrepared(record, "funding", child, review, 900_999L)
  assertFails { grant.assertPrepared(record, "funding", child, review, 901_000L) }
  ```

- [x] Run from `mobile/android`: `./gradlew :gizu-stored-signer:testDebugUnitTest --tests '*EarnDepositApprovalTest' --tests '*EarnDepositJournalTest' --console=plain`; expect missing classes.
- [x] Implement the grant and journal. Persist child identity before any signing; derive used/reserved budgets from durable child signing evidence, not volatile counters alone. A failed write stops signing. Restart reconstructs pending/unknown signed state and requires reconciliation before cancellation, reservation release or replacement. Preserve existing journal formats and derivation versions.
- [x] Run new tests plus `EarnFundingBatchApprovalTest`, `FundingReservationsTest` and `WalletStoreMigrationTest`; expect pass. Include death immediately before/after each durable record boundary and corrupt-journal rejection.
- [x] Commit as `feat: bind deposit authority to native journal and limits`.

## Task 4: Prepare and execute the journey through existing native engines

**Files:** Create `K/earn/EarnDepositPreparer.kt`, `EarnDepositGateway.kt`, `EarnDepositEngineAdapter.kt`, `EarnDepositCoordinator.kt`, `KT/EarnDepositCoordinatorTest.kt`, `KT/EarnDepositPreparerTest.kt`; modify `K/WalletStore.kt` and narrowly extract reusable preparation from `K/GizuStoredSignerModule.kt` when required. Existing `NativeFundingPlanner.kt`, `EarnSourceReplanner.kt`, `EarnSponsoredEngine.kt`, `EarnPayoutEngine.kt` and `EarnPayoutGateway.kt` remain the financial execution units.

**Interfaces:** `EarnDepositPreparer.prepare(record: WalletRecord, profile: Int, budgetAtoms: String, draftId: String?): JSONObject` consumes Tasks 2 and 3. `EarnDepositCoordinator.confirmed(journeyId: String, revision: Int, grant: EarnDepositApproval)`, `reconcile(journeyId: String): Map<String, Any>`, `resume(journeyId: String, revision: Int, grant: EarnDepositApproval)`, `cancel(journeyId: String, revision: Int)` are suspend functions. Inject engine/gateway/time dependencies for tests. `EarnDepositEngineAdapter` obtains each engine's exact prepared review, checks the grant and forwards its authority callback; it never implements a second signer.

- [x] Write failing preparation tests proving no passkey, private-history auth, signing or spend occurs during review; repeated draft edits allocate once. Preview must use selected-source budgets and qualified live bounds. Write coordinator tests with two sources, out-of-order credits and odd atoms; the existing cumulative offset must produce the correct total floor and no leg starts before complete authenticated membership.

  ```kotlin
  assertEquals("700000", nativePayoutAmount("7000009", "0", "hold"))
  assertEquals("800001", nativePayoutAmount("8000009", "7000009", "hold"))
  assertEquals(0, payoutSubmissionsBeforeAllCredits)
  ```

- [x] Run focused `EarnDepositPreparerTest` and `EarnDepositCoordinatorTest`; expect missing implementation.
- [x] Implement native preparation using existing derivation/allocation, source selection, fee rules and reservation mechanisms. Preview each source/leg separately at that source's quoted minimum confidential credit; aggregate typed amounts on device. Bind each provider's positive quoted minimum, use the existing vault slippage/share-price guard for the minimum assets/shares, and preserve current source/Robinhood fee caps without adding a new arbitrary buffer. Review expiry is the earliest source/route/simulation validity limit. Fail before funding if those terms do not yield positive net holding and investment. Invalidate/release only never-signed reservations when editing. No account directory is posted to the backend.
- [x] Implement coordinator order: source funding → all authenticated source credits → independent hold/invest payouts → both verified destination legs → fresh real-balance deposit plan → verified shares/receipt. Use grant-scoped read authentication instead of repeated passkey reads; exact operations retain native engine validation. Reserve simulation is never a live withdrawal. Fail closed if prerequisites or limits differ. Each child's positive minimum must satisfy both its reviewed bound and aggregate result requirements.
- [x] Add tests for hold paid/invest unknown, missing child journal after restore, repeated confirmation/resume, stale revisions, source failures, quote revisions outside bounds, provider outage, failed signature persistence, duplicate payout source credit and process death. Reject a deposit plan whose total budget exceeds the USDG attributable to this journey's verified wallet 2 payout receipts, even if unrelated tokens arrive meanwhile. Assert no second hold submission, no reused investment account, no withdrawn/returned operations and no premature success. Cancellation of an already invested journey revokes authority without changing its invested result. Limit selected source rereads to planner needs; never scan the whole account directory per poll.
- [x] Run these tests plus existing sponsored, payout, batch-offset and source-reservation tests. Assert multi-source funding uses the current shared reservation ledger and cannot race a Swap for the same funds.
- [x] Commit as `feat: coordinate confidential routing and USDG deposit natively`.

## Task 5: Expose one native ceremony with safe lifecycle and status reads

**Files:** Create `K/earn/EarnDepositHost.kt`, `KT/EarnDepositHostTest.kt`; modify `K/GizuStoredSignerModule.kt`, `mobile/modules/gizu-stored-signer/ios/GizuStoredSignerModule.swift`, `mobile/src/services/wallet/nativeBridge.ts`, `mobile/tests/unit/storedSignerIos.test.ts`.

**Interfaces:** Register Task 1's five bridge methods. `EarnDepositHost` owns the active coordinator job and native grant. `confirmEarnDeposit` presents one final semantic review, calls `PasskeyGate.authorize` with the native envelope digest, then returns a public running snapshot while the native job continues. `getEarnDepositStatus` reads public journal/progress without restarting execution or invoking a passkey. Other signing/creation operations are denied while the coordinator holds the wallet mutation lease; status reads remain available.

- [x] Write failing tests that count exactly one passkey for a full uninterrupted coordinator run, zero during prepare/status, and one more only after revoked/expired authority is explicitly resumed. Test genuine background, lock, destroy and cancellation versus bounded credential-provider focus transitions. Assert status reads remain responsive while funding settles, and a second confirm is rejected.

  ```kotlin
  assertEquals(0, passkeyCallsAfterPrepare)
  assertEquals(1, passkeyCallsAfterInvestment)
  assertEquals(0, withdrawalCalls)
  assertEquals(0, returnCalls)
  ```

- [x] Run focused native host/coordinator tests and `cd mobile && npm test -- tests/unit/storedSignerIos.test.ts` to observe missing method/capability behavior.
- [x] Implement host registration without stretching the existing two-minute ordinary ceremony globally. The journey's owned job and wallet mutation lease are explicit; polling must not deadlock behind a long-held bridge promise/ceremony mutex. Preserve `withProviderUi` focus checks, revoke on genuine background/lock/destroy, cancel network work and retain signed progress. Register cancellation with the bridge queue's interrupt path so it cannot wait behind its own execution. Add `getEarnDepositStatus` to coalesced public reads.
- [x] Return `earnDepositJourney: true` only for the implemented Android path. iOS returns false and keeps current Earn APIs intact; no fixture fallback. Run `npm run stored-signer:check:ios` and platform capability regression tests.
- [x] Run native host tests plus existing ceremony/bridge queue/capability tests; expect pass, with no delegation prompt reappearing as a second passkey inside a granted sponsored stage. Required EIP-7702 disclosures remain in the single final native review.
- [x] Commit as `feat: expose one passkey deposit ceremony and native progress`.

## Task 6: Add the typed service and screen controller

**Files:** Create `mobile/src/services/earn/depositJourney.ts`, `mobile/src/features/earn/useDepositJourney.ts`, `mobile/tests/unit/earn/depositJourneyService.test.ts`; modify `mobile/src/features/earn/EarnProvider.tsx` for injectable service ownership. Use functional tests in Task 7 to exercise the real controller.

**Interfaces:** `createEarnDepositService(bridgeFactory = getStoredEarnDepositSigner): EarnDepositService`; add `getStoredEarnDepositSigner` to `nativeBridge.ts`. `useDepositJourney(profileId: EarnProfileId)` returns amount text, typed display state, `setAmount`, `review`, `confirm`, `resume`, `cancel`, and details visibility. It consumes Task 1 snapshots and Task 5 native methods; it does not call child signing services directly.

- [x] Write failing service tests for malformed/wrong-owner snapshots, unsupported capability, native error after possible commit, aborted/stale prepare result and duplicate confirm. Assert cancel calls the journey-specific native method and does not invent a completed rollback.

  ```ts
  expect(native.confirmEarnDeposit).toHaveBeenCalledTimes(1);
  expect(native.cancelEarnDeposit).toHaveBeenCalledWith(
    owner.walletId,
    journeyId,
    revision,
  );
  ```

- [x] Run `cd mobile && npm test -- tests/unit/earn/depositJourneyService.test.ts`; expect absent service failure.
- [x] Implement the adapter, request-generation guard and controller. Editing invalidates review; a late result cannot replace the current amount. Before another prepare after a failed bridge result, read the saved native draft. Poll only running/paused-needing-reconciliation snapshots at `2s, 4s, 8s, 16s, 30s` then `30s`, for at most 15 minutes in one foreground screen session; stop timers on terminal state/unmount/background. Leaving the deposit screen or switching wallet sessions cancels remaining local authority through the journey-specific native cancellation method, without deleting its signed child records. A status request reconciles only the active journey under existing read rules, not all accounts.
- [x] Add typed copy for `quoteUnavailable`, `previewUnavailable`, `insufficientFunds`, `uneconomicAmount`, `termsChanged`, `approvalExpired`, `settlementPending`, `submissionUnknown`, `recoveryRequired` and `unsupportedCapability`. Old Render `404` preview responses become unavailable before funding, not a fallback estimate.
- [x] Run focused service tests, existing `sourceFundingService.test.ts` and `privatePayoutService.test.ts`, then typecheck. Confirm legacy adapters are still reachable for old journals and withdrawals.
- [x] Commit as `feat: connect guided deposit controller to native progress`.

## Task 7: Replace the deposit UI and retain investment actions

**Files:** Create `mobile/src/features/earn/DepositJourneyScreen.tsx`, `useLegacyEthereumDeposit.ts`, `EarnInvestmentScreen.tsx`, `mobile/tests/functional/earn/deposit-journey.functional.test.tsx`, `mobile/tests/support/depositJourney.ts`; modify `EarnScreen.tsx`, `RobinhoodExecutionPanel.tsx`, `VaultExecutionPanel.tsx`, `mobile/src/navigation/types.ts`, `RootNavigator.tsx`, existing Earn functional fixtures as necessary. The new test helper provides deterministic native snapshots/service responses; it does not mock the screen controller.

**Interfaces:** `DepositJourneyScreen({profileId, opportunityId?})` consumes Task 6's controller for Robinhood. `useLegacyEthereumDeposit(intent: EarnIntent)` maps existing native child-journal state into a presentation `{phase, activeStage, busy, message, review, primaryAction}` with `activeStage: 'funding' | 'payouts' | 'liquidity' | 'vault'`; each `primaryAction` invokes the existing validated service for that stage with its explicit approval. It never fabricates a native journey grant or marks a forecast executable. Add typed `EarnInvestment: {intentId: string}` navigation for saved cycle details, scoped to the authenticated wallet. The current catalog Deposit route selects the vault's validated profile once. It no longer renders `CatalogEarnStart` and all technical panels as the new deposit path.

- [x] Write real-screen failing tests for Amount → Review → one Confirm → progress → verified Invested. Assert protocol image/vault identity, visible net held/invested USDG, source budget, positive minimums, gas cap/reserve, and Details. No wallet setup/private-read/individual payout/withdrawal controls appear in deposit.

  ```ts
  expect(screen.queryByRole("button", { name: /wallet 1 payout/i })).toBeNull();
  expect(screen.queryByRole("button", { name: /withdraw/i })).toBeNull();
  expect(native.confirmEarnDeposit).toHaveBeenCalledTimes(1);
  ```

- [x] Run `cd mobile && npm run test:functional -- tests/functional/earn/deposit-journey.functional.test.tsx`; expect missing screen behavior.
- [x] Compose the existing `Screen`, `Typography`, `Button`, `Surface`, vault protocol assets and amount styles. Use one primary action per state; show accessible live progress, inline reasons, keyboard-safe amount input and readable large text. Source identities/full hashes remain in expandable Details. Amount changes and expiry disable the review's confirmation. Never label a reserve as an already-paid fee.
- [x] Move existing withdrawal/return and legacy reconciliation controls into `EarnInvestmentScreen`; reuse execution panels with an explicit presentation mode to hide new-deposit controls where appropriate. New catalog requests use fresh drafts; View investment selects the saved intent, not a new pair. The Ethereum presentation uses existing source funding, payout, liquidity and vault services in dependency order, showing only the active stage and explicitly disclosing its separate approvals. It preserves currently supported deposits/recovery and does not substitute the Robinhood coordinator or mock flows. Existing partially funded legacy cycles expose one relevant recovery action leading to their saved details, not a new draft.
- [x] Extend functional tests for empty/unavailable balance, too-small budget, unavailable preview, stale amount response, quote expiry, native rejection, duplicate taps, terms changed, partially paid legs, background/unmount, restored cycle, reopened saved deposit, Ethereum capability behavior, and separate withdrawals. Verify successful exit never calls withdrawal/return. Check featured unsupported vaults remain informational and never acquire a Deposit action.
- [x] Run all Earn functional tests plus source/deposit controller unit tests and formatting/typecheck/lint. Update fixtures for intentional copy/layout changes, preserving financial payload assertions.
- [x] Commit as `feat: replace technical earn panels with guided deposit UX`.

## Task 8: Full validation and backend compatibility handoff

**Files:** Update `docs/internal/CONFIDENTIAL_EARN.md`, `docs/feature-plans/PARITY.md`, `docs/app-guide/MOBILE_LOCAL_DEVELOPMENT.md`; update this plan's checkboxes only for verified deliverables.

**Interfaces:** Deployment notes identify the two read-only preview routes and platform capability requirements. New APKs paired with old backends fail before funding. No local database/environment secrets or keys are committed.

- [x] Run `cd backend && npm run typecheck`, `npm test`, `npm run build`; expect pass. Run `cd mobile && npm run check`, `npm run format:kotlin:check`, `npm run stored-signer:test`, `npm run stored-signer:check:ios`. Run Android `:gizu-stored-signer:testDebugUnitTest`. If Doctor stops the aggregate check, report it and run coverage separately; do not claim the full aggregate passed.
- [x] Run `npm run stored-signer:test:ios` when the configured simulator/runtime is available; otherwise report that native iOS checks were unavailable. Do not claim an iPhone deposit test. Run isolated fork simulations separately from deterministic tests and identify any donor/stub assumptions.
- [x] Review the final branch against the approved spec, concentrating on every signing entry point, post-crash signed-state recovery, reservation release and preview/executable separation. No review finding is resolved by bypassing native semantic validation.
- [ ] Document exact public backend route/version requirements and the unsupported-platform behavior. Prepare deployment instructions for the teammate; do not deploy/push automatically. After the updated backend is deployed, perform public read-only compatibility probes before device funding review.
- [x] Commit the documentation and any evidence-backed corrections as `docs: document guided deposit operation and deployment`.

## Task 9: Build and verify on the connected phone

**Files:** No generated APK, ignored Android project, keystore, `.env`, device dumps or private receipts enter Git. Record sanitized results in `docs/internal/CONFIDENTIAL_EARN.md` if a meaningful acceptance record is needed.

**Interfaces:** Build uses the verified existing Android application ID `com.example.gizu.dev` and activity `io.gizu.android.MainActivity`. This is a standalone release with native passkeys and the hosted backend.

- [x] Confirm ADB connection and installed package/certificate, plus preview deployment compatibility. Recheck the APK package/certificate before installation. Do not run prebuild to recreate the ignored native project.
- [x] Build from `mobile/android` with Node 24 on PATH, Java 17, the existing Android SDK, `NODE_ENV=production`, `GIZU_BUILD_VARIANT=production`, `EXPO_PUBLIC_API_URL=https://gizu-app.onrender.com`, `EXPO_PUBLIC_PASSKEY_MODE=native`: `./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain`. Require build success and new backend host in the embedded bundle/native endpoints.
- [ ] Install with `adb install -r app/build/outputs/apk/release/app-release.apk`, then open `adb shell am start -n com.example.gizu.dev/io.gizu.android.MainActivity`. Ask the user to unlock their wallet; do not operate biometric approval.
- [ ] Verify vault entry, keyboard/scroll/layout, Morpho icon, amount editing, prospective review, single applicable action, expansion of Details and provider-error handling. Confirm no funds move on Review and unsigned cancellation. Reopen without USB/Metro to verify the standalone experience.
- [ ] Only after specific spending authorization, ask the user to Confirm a chosen budget. Count passkey prompts and verify both payouts, exact actual fees/reserves, shares and saved invested result. Do not withdraw. If live providers block completion, report the failed phase with saved location/evidence and keep the test explicitly incomplete.
- [x] If funded acceptance is authorized, exercise a carefully chosen interruption/reopen scenario without authorizing extra money; verify no duplicate allocation/spend. Otherwise rely on deterministic recovery tests and clearly identify live recovery as not run.

## Dependency and execution order

Execute sequentially: contracts → isolated previews → grant/journal → native preparation/execution → native host → service/controller → UI/saved investment → validation → phone. Keep capabilities disabled until their native path and preview dependency are ready. Commit only each task's intended paths; preserve the earlier backend URL changes when touching shared files.

Recommended execution is **Native**: one implementer maintains the grant, coordinator and bridge contracts throughout, followed by a fresh whole-branch review. The user may instead choose **Subagent-driven** execution with task-level reviews. Implementation begins after the user reviews this plan and selects the execution approach.

## Self-review record

- Spec coverage: all screen states, source selection/reservations, fees/split, unsigned fresh allocation, grant limits/revocation, privacy, isolated previews, legacy journals, Ethereum capability truthfulness, withdrawal separation, deployment and device acceptance have owning tasks.
- Type consistency: the same `DepositSnapshot`, `EarnDepositService`, five bridge method names and native coordinator interfaces are used throughout.
- Review focus: each of the five conditions above has an explicit regression test in its owning task.
- Financial boundaries: no preview can execute; exact engine review validation remains mandatory; every source and leg retains its journal; no signature authority survives restart.
- Verification scope: this is a plan, not a completion record. Runtime checks, approval counts and live mainnet acceptance are still pending implementation.

## Execution evidence (October 11)

Tasks 1–7 are committed with deterministic verification. Task 8 checks ran; Expo
Doctor reports the pre-existing SDK patch mismatch and iOS native setup is missing.
Coverage runs separately. Updated preview deployment and live prospective simulation
remain unverified (Render 404; Robinhood probe HTTP 403). Task 9 funded acceptance
requires deployed previews, usable providers and specific spending authorization.
No fallback terms or automatic mainnet spend are permitted by these checkboxes.

Final fresh review found five Important gaps. The single fix pass adds native
regressions for receipt reconciliation before renewed review, explicit saved-payout
retry, credential-window departure, unsigned cancellation and preparation death.
No minors or declined judgments were reported. Deployed previews, funded phone
acceptance and physical credential-focus/lock verification remain unchecked.
