# Confidential Earn mobile implementation plan

> Execution: implement in this session, using the supplied handover and test-driven development. No mainnet transactions are authorized by this plan.

**Goal:** Show the funded source wallet's Monad USDC, then integrate a reviewable confidential earn lifecycle with two native-owned destination wallets created after intent.

**Architecture:** Keep account 0 as the source. Read-only chain/token adapters report integer balances. Native code owns new destination keys, authorization and protected recovery. Earn controllers consume typed proposals; provider output cannot authorize signing.

**Tech stack:** Expo/React Native, TypeScript, Kotlin/Swift, Rust native signer, existing Fastify backend.

**Spec:** `research/confidential-earn/APP-INTEGRATION-HANDOVER.md` and `APP-INTEGRATION-TASK.md`, amended by the user's September 30 request: USDC first, funded wallet as source, two new destinations on intent.

## Global constraints

- Source profile: Monad mainnet 143 and Circle USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603`, six decimals. Confirmed by the user: Monad mainnet 143.
- Read-only balances do not grant mainnet signing capability. Never relabel a native MON transfer as an ERC-20 transfer.
- Generate destinations through native authorization only, after intent; never import the research `.env` keys or use JS private keys.
- Confirmed confidential input splits floor(input/10) to wallet 1 and the remainder to wallet 2. Only wallet 2 invests.
- Preserve original approval, actual costs, and estimates for remaining actions independently. No sibling-wallet top-ups, helper contract or common application fee recipient.
- Unsupported execution stays disabled with an explicit reason. No mock services in live paths.
- No investment, source funding, withdrawal or return broadcasts during implementation.
- Earn stops at an invested position. Future redemption simulation is isolated and reserve-only; actual withdrawal and returns require a later explicit user action and fresh authorization. Reconfirmed by the user on September 30.

## Review focus

1. RPC response ordering, duplicate IDs, wrong chain and malformed ERC-20 words must never become a displayed zero.
2. Account change/cancellation must discard stale balances.
3. A USDC view must never invoke the older MON transfer signer.
4. Retrying or restoring an earn intent must not create new funded destinations or duplicate a spend.
5. Public provider expiry and receipt success alone cannot prove safe replacement or cycle completion.

## Stage 1: Monad USDC source balance

Files: `mobile/src/domain/wallet/assets.ts`, `amounts.ts`, `mobile/src/services/wallet/usdcBalance.ts`, `storedAccess.ts`, `mobile/src/features/wallet/WalletProvider.tsx`, Home/Deposit/Account screens and related tests.

- [x] Add adapter tests for ERC-20 `balanceOf`, decimals, chain, code presence, zero, large uint256, malformed/duplicate/error responses, abort and timeout.
- [x] Implement pinned-source-asset balance service returning base-unit strings; use exact six-decimal formatting.
- [x] Use an explicit native mainnet-view session while retaining the historical testnet diagnostic path; do not expand existing native transfer authority.
- [x] Add functional tests for Home balance, Deposit token/network instructions, refresh/error/account switch and unavailable USDC withdrawal without invoking MON signing.
- [ ] Update docs, run affected tests, TypeScript, lint and required mobile checks, then verify the device build.

## Stage 2: Native intent-owned destination wallets

Files: `mobile/src/domain/earn/`, `mobile/src/services/wallet/nativeBridge.ts`, `mobile/modules/gizu-stored-signer/{core/src,android/src/main,ios}`, earn UI/controllers and native tests.

- [x] Define an immutable intent binding source wallet, selected supported profile, intent ID and exactly two destination roles.
- [x] Add deterministic native derivation/recovery tests and encrypted persistence tests before implementing creation. Address allocation must be native, idempotent and bound to the existing backup-verified source wallet.
- [x] Extend native semantic APIs for creation/readback with native review and passkey authorization; return public descriptors only.
- [x] Surface recovery readiness before funding; repeated UI submissions return the same pair. Preserve original source account and backup compatibility.
- [ ] Connect an explicit user-intent action and verify Android and iOS boundaries separately.

## Stage 3: Policy, proposals and providers

Files: new focused `mobile/src/domain/earn/` policy/ledger/lifecycle modules, typed service adapters and backend quote/simulation modules.

- [x] Port and test handover integer formulas, exact 10/90 conservation, fee sampling/headroom, reserve versus fee accounting, resolver overhead and price conversion.
- [ ] Define immutable versioned proposals and per-leg recovery states. Bind chain/owner/vault/assets/reference block/revision/deadlines/fee bounds/minimum outputs.
- [ ] Implement unsigned Aurora/Fusion/RPC/paymaster/vault proposal adapters with strict semantic validation and server-held provider credentials.
- [ ] Provide and verify post-deposit simulation infrastructure. Missing configured infrastructure blocks execution, never substitutes fixed gas estimates.
- [ ] Integrate operation-scoped confidential settlement evidence and a ledger retaining already-paid Fusion costs.

## Stage 4: Native execution and user lifecycle

- [ ] Add constrained native approval, permit/order, EIP-7702/UserOperation, vault and return operations; persist approved payload/hash before submission.
- [ ] Add crash/unknown submission/early expiry/replacement/reorg/restore/concurrency tests and recovery adapters before enabling affected paths.
- [ ] Connect review, progress, invested position, user-triggered withdrawal and per-leg return screens to real services.
- [ ] Enforce zero shares, explicit WETH reconciliation, authenticated credit and fresh residual <0.5 USDC equivalent (<0.1 optimal).
- [ ] Run research regression, app functional/coverage, native and fork lifecycle checks. Document unavailable infrastructure/device evidence and keep affected execution gated.

## Delivery evidence

Track implementation and checks here as each stage completes. A balance change is not completion of Confidential Earn. The phone's new development certificate also requires publication in `gizu.io`'s association file before its native passkey ceremony can succeed; the prepared public proposal is `mobile/.credentials/assetlinks.proposed.json`.

## September 30 implementation evidence

- Mobile check: 48 suites / 386 tests passed, TypeScript, formatting, lint and Expo Doctor 21/21 passed before readiness UI additions. Re-run required after later edits.
- Rust core: 13 tests passed. Android protected storage tests and APK build passed; native APK installed on SM-S911B without clearing data.
- Backend readiness: typed read-only profile check implemented; 38 tests passed. All calls pinned to a fresh reference block, with eight 25th-percentile fee samples for Ethereum. No signing or broadcasts.
- Live Monad RPC confirmed 143 and pinned USDC decimals 6.
- iOS execution unavailable on this Mac: only Command Line Tools installed, no Xcode/simulator. Swift source/tests added; platform acceptance remains unverified.
- Runtime passkey association: frontend served by Render; prepared public certificate addition, live association still contains the old certificate. Deployment investigation continues.

Ruling: use one immutable destination pair for the first intent per source wallet, derived in `m/44'/60'/143'/destinationChain'/role` — supports the requested initial two wallets while preserving the existing verified entropy backup and preventing retry allocation — additional independent cycles require a versioned native allocator and recovery discovery, not reuse of this pair.

Ruling: after backup restoration, expose recoverable candidate addresses but retain a native recovery gate; selecting another supported profile is permitted only while this gate is set — missing local history cannot prove absence of prior spending — recovery requires authenticated provider and chain reconciliation before any funding is enabled.

Ruling: retain this phone-linked checkout on a new `codex/confidential-earn-mobile` branch — preserves the installed APK, SDK and running Metro setup alongside the user's uncommitted handover — a separate worktree would need to recreate the ignored native build/runtime artifacts.

Remaining: constrained mainnet signing; confidential identity/authentication and operation-scoped settlement; source token-sponsored operations; payout routing; real Fusion/provider quotes and post-state redemption simulation; invested/withdrawal/return UI and fork/device acceptance. The balance and wallet-setup milestones do not complete the full handover.

## September 30 continued implementation

- Native read authentication, private balance transport and unsigned routing previews are implemented; neither an aggregate balance nor a dry quote proves operation-scoped settlement.
- Ethereum destination planner now performs dynamically measured deposit and future full-redemption simulation in a disposable server-side fork. A real local Anvil/public-RPC check passed exact SDK approval/deposit/redemption with zero ending fork shares. No live funds moved.
- Ethereum native core constructs constrained allowance/deposit/full-redemption calls. Thirty core tests passed after fixing redemption's double reserve: the withdrawal can spend its reserved gas without reserving it again. Platform integration is in progress; no device execution acceptance is claimed.
- Source USDC sponsorship preparation is unsigned and address-only. Conservative ceiling approval is rebuilt and re-estimated instead of accepting the SDK floor; final source nonce/delegation/allowance/balance changes invalidate the preview.
- Corrected exit policy to exclude wallet 1's intentional holdings from wallet 2's exit dust. Regression observed red then green.
- Applying implementation/delegation skills to independent native-core, native-platform and destination-planner scopes. Each scope is reviewed and integrated in this phone-linked checkout; no commits or publishing during implementation.
- Continue Robinhood dynamic paymaster planning, source/payout/Fusion constrained signing, user-triggered withdrawal/returns, operation-scoped settlement and real-screen recovery tests. Render publication/phone installation are separate delivery steps when access is available.

## September 30 integrated Android execution and recovery

The earlier remaining-work paragraphs are historical milestones, superseded by this continuation record.

- Android now has constrained source USDC sponsorship, exact independent confidential payouts, native Fusion permit/order signing, both vault profiles, user-triggered withdrawal, and separately authorized return legs. No actual withdrawal is run by Earn; future redemption is simulated only on isolated forks.
- Dynamic Ethereum and Robinhood reserve simulations and return planners retain original approval separately from actual journaled charges and current estimates. Native state independently validates the final operation rather than trusting provider calldata or pricing metadata.
- Saved private payouts refresh only unsigned expired preparations within the same immutable funding-role reservation. Portable server-authenticated envelopes recover exact preparations across backend restarts; signed retry never allocates a new nonce or changes terms.
- Ethereum same-nonce cancellation reviews retain original and replacement transactions, reconcile the finalized winner, and relock after reorg. No cancellation clears a spend merely because a provider calls it expired.
- Real AppRoot journeys cover source credit, independent payout blocking, separate permit/order steps, invested stop, explicit withdrawal and return approval, dismissal, uncertain submissions and cancellation recovery. Service tests use the real adapters with native/provider boundaries replaced.
- Prepare pinned Anvil runtime and persistent recovery/provider configuration for Render; deploy and publish the existing certificate addition when access arrives. Backend source changes alone do not update the phone's remote server.
- Required full checks and native/APK verification are being rerun after final integration. Device/passkey/mainnet-provider acceptance remains separate evidence; no mainnet transactions were sent.

### Final review fixes and operational limits

- Removed the joint hosted routing-preview UI, service and backend endpoint. Only independent destination quotes remain.
- Unsigned payout cancellation now resumes the same immutable child/reservation after fresh native authentication and review. A new role allocation is not created.
- Sponsored preparations can be discarded only before a spending UserOperation exists and outside an active signing/persistence guard; delegation history remains encrypted and is not claimed revoked.
- Final exit checks combine fresh native operation-specific return credit with canonical balances and conservative relative token/ETH/USDC pricing, including WETH and strict dust boundaries. Completion is never automatic after deposit.
- Latest root verification: Rust 65 passed; Android 140 JVM tests and USB APK build passed; backend typecheck/build and 143 passed, three optional upstream-fork skips. Full mobile combined check passed TypeScript/format/lint/Expo Doctor 21/21 and 540 tests across 64 suites. Passkey and execution device acceptance remain pending.
- Seed-only restore without a native journal remains fail-closed. Server-restart recovery does not reconstruct a lost device journal or prove old spending absent.

### Requested pre-deployment USB phone test

The connected Samsung phone is detected. The ignored local server configuration uses only authorized research provider credentials, the user-supplied Merkl key, isolated PostgreSQL and a new durable local recovery key. Health and a real Merkl opportunity request succeeded. The Render-internal database hostname is not used locally. No provider credentials are copied into the APK or this plan.

A compile-time `gizuEarnBackend=usb` opt-in selects only fixed loopback in Android debug. All native Earn gateways, including private balance, use that origin. JavaScript uses the same explicit Metro origin and USB reverse mappings. Default debug and all release variants remain on the fixed Render HTTPS backend; invalid property values fail. The real native passkey flow remains enabled. Corrected stale testnet onboarding and obsolete investment-signing availability text found while opening the real app. Verified the actual full combined mobile check and 140-test native build before installation.

Actual Earn execution still requires qualified Aurora normal service fees and domain association for the APK certificate. Backend deployment and a PR remain deliberately pending until the user completes phone testing. No spending authorization or mainnet transaction was performed by the implementer.

The USB APK update installed successfully without clearing app data. The user completed existing-wallet passkey access; inspection confirmed the real Home screen with 0 USDC and the Earn setup form with its Monad-mainnet source address. The implementer opened only the Earn form and did not authorize wallet preparation or spending. Destination selection is requested from the user because it becomes immutable. Existing-wallet access succeeded despite the outstanding association publication verification; new registration and operation signing are separate device checks.

The user selected Robinhood for mainnet testing. Explained that localhost applies only to the backend transport: native chain RPCs remain Monad 143 and Robinhood 4663 mainnet. The user is instructed to choose Robinhood and approve wallet preparation personally; preparation is not a transfer. The source currently has zero USDC, so funded quote/execution acceptance is not claimed.

### September 30 funded phone continuation

The user confirmed successful Robinhood wallet-pair preparation. They subsequently authorized funding the app source from the earlier Ethereum research account's returned confidential balance and explicitly approved the research key's 4-bps fee/referral for this single transfer. One intent was signed, durably saved and submitted; the finalized Monad receipt delivered 3.079262 USDC from 3.081997 input (0.002735 difference). No Earn/vault/withdrawal action followed. Details and verification limits are in `research/confidential-earn/MAINNET-TEST.md`.

Live provider testing discovered a three-day generated unsigned payout deadline despite a ten-minute quote. Fresh unsigned preparations now narrow only the deadline before hashing/review; signed/recovered authorities remain immutable. Root reran backend typecheck, all tests (149 total: 146 passed, three optional skips) and build successfully. No native APK change was required for this backend fix.

Authenticated history access for the current research key is invite-only and unavailable. Native operation-specific credit/reconciliation remains gated, as does the key's unqualified fee/referral configuration. These need Aurora provider configuration before actual funded Earn testing. Render deployment and PR remain pending at the user's request; the work remains uncommitted on `codex/confidential-earn-mobile`.

### Phone funding review runtime diagnosis

The user's 3-USDC review showed “undefined is not a function.” Device UI inspection, the installed React Native abort polyfill and failing tests identified `AbortSignal.throwIfAborted` as unsupported. A shared `aborted`-flag check fixes the funding and all matching investment/return/exit call sites while retaining cancellation barriers. The real source-service AppRoot regression reaches unsigned review with the actual React Native abort implementation. Three service regressions were observed red then green.

Root verification passed the full mobile check: typecheck/format/lint, Expo Doctor 21/21, 64 suites and 544 tests. The first sandboxed Doctor run could not reach Expo registries; the complete network-enabled run passed. No Kotlin/Rust/native binary changed.

The phone review now reaches native quote preparation, which still reports the generic native wallet failure. The active laptop backend's unsigned quote gate returns HTTP 503 `EARN_AURORA_FEE_UNQUALIFIED`; the previous research-key exception applies only to the separate funding transfer. Provider history access is also still unavailable. No Earn spending was signed or sent; qualified Aurora fees and authenticated history are required to continue the funded flow.

## October 1 approved fee and review correction

Approved correction scope: reuse existing gateway, source review panel, payout/return planners and native engines. Replace global exact-two-bps assumption with versioned server-controlled route rules. Rules require explicit collector/referral qualification, zero Gizu/integrator fees, bounded exact executable quote fee breakdown and minimum output. Persist policy within quote ID/recovery envelope; native review binds same proof. Preserve legacy signed retry bytes. Dry source preview must remain informational and cannot sign. Missing qualified fees or operation-scoped history entitlement blocks new authorization before funding; existing settlement logic remains strict. Safe errors cross native boundary via allowlist. Verify backend, JS functional journey, Rust and Android; install USB build if device attached. No deployment or mainnet transactions.

Implementation order: add failing fee-policy and blocked-review regressions; centralize server route validation; bind proof in recovery and native reviews; permit unsigned preview in the existing funding panel; propagate allowlisted errors; run required checks and update device build. Operator qualification is never inferred from a dry quote or collector name.

Fee correction validation: centralized versioned route rules, exact quote proof in recovery/native review, legacy signed retries preserved, single existing funding panel/button reused, allowlisted native errors, and a qualification gate before funding are implemented. Current live dry quoting additionally rejects the route; unavailable previews expose blockers and null estimates without fabricating credit or authorizing spending. Android 143 tests and USB APK installation passed; Rust 67 tests passed; backend 154 passed/3 optional upstream fork skips plus typecheck/build passed. Phone unsigned review validation and final mobile check follow.

Final October 1 acceptance: full mobile check passed (64 suites / 548 tests, Expo Doctor 21/21, coverage, TypeScript, format/lint). Android 143, Rust 67 and backend 154 tests passed; backend 3 optional upstream fork skips. Phone review for budget 3 displayed source 2.98649, estimated gas 0.00351 and three provider blockers; the sole funding authorization remained disabled. Existing pair and source balance survived reinstall. No transactions or deployment were performed. External remaining requirements are provider route availability, verified fee beneficiaries/referral commission with zero Gizu fee, and qualified authenticated history entitlement.
