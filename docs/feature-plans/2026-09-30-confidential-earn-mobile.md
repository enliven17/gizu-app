# Confidential Earn mobile implementation plan

> Historical staged plan (2026-09-30), consolidated 2026-10-08. Checkboxes capture
> the original planning snapshot, not current completion. Implementation, later
> multi-account decisions and evidence live in [the integration reference](../internal/CONFIDENTIAL_EARN.md).
> This document does not authorize transactions.

**Goal:** Show the funded source wallet's Monad USDC, then integrate a reviewable confidential earn lifecycle with two native-owned destination wallets created after intent.

**Original architecture:** Keep account 0 as the source (superseded by later native multi-account funding selection). Read-only chain/token adapters report integer balances. Native code owns new destination keys, authorization and protected recovery. Earn controllers consume typed proposals; provider output cannot authorize signing.

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

## Decisions retained from implementation

- Destination derivation began with an immutable pair per intent/profile using
  `m/44'/60'/143'/destinationChain'/role`. Additional cycles required a versioned
  allocator and recovery discovery; they must not reuse a previously funded pair.
  Later cycle behavior is documented in the integration reference.
- Restore may expose candidate addresses while keeping a native recovery gate.
  Missing local history cannot prove absence of spending or authorize new funding.
- Sponsorship preparation stays unsigned/address-only. Fee caps use conservative
  ceiling arithmetic and fresh source nonce, delegation, allowance and balance checks.
- Redemption simulation runs on disposable forks and must not reserve withdrawal
  gas twice. Wallet 1's intentional holdings are excluded from wallet 2's exit dust.
- Unsigned expired payouts can refresh within their existing reservation. Signed
  retries retain exact bytes; server recovery cannot reconstruct a lost device journal.
- Fee qualification is versioned and route-specific, with verified collectors and
  zero Gizu/integrator commission. Dry previews never acquire spending authority.

## Evidence and limitations

The consolidated [integration evidence](../internal/CONFIDENTIAL_EARN.md#historical-verification-summary)
retains test totals, device observations, the separately authorized test-funding
transfer and provider failures. Local build success, a funded account and an
unsigned review do not establish end-to-end Earn settlement.

Use [native USB setup](../internal/NATIVE_SIGNER_EARN.md#android-usb-backend-test-build)
for current transport instructions and [passkey hosting](../app-guide/PASSKEY_HOSTING.md)
for association deployment. Historical branch names, temporary certificate proposals
and session-specific installation instructions are intentionally omitted.
