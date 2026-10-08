# Confidential Earn integration

The supplied `research/confidential-earn/APP-INTEGRATION-HANDOVER.md` is the product specification. This file records the app integration and its verification boundaries; it is not permission to send a mainnet transaction.

## User actions

**Earn ends at an invested vault position.** The initial fee calculation simulates a future full redemption in a disposable server-side fork only to estimate the withdrawal reserve. It never withdraws the live position. The user must click Withdraw later, review fresh fees, and authorize redemption separately. Aurora return quotes and operations follow that requested exit; their future executable costs are excluded from the initial deposit estimate.

Funding uses Circle USDC `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` (six decimals) on Monad mainnet 143. Swap and Earn share native source selection across accounts 0, 1 and allocated public receiving accounts, with fresh balances and shared reservations. A sufficient single account is preferred; a larger budget can span multiple sources. One combined native review and passkey assertion authorizes the selected source funding operations. Each source retains its own fees, transaction and recovery journal. Changed terms or an interrupted/expired approval require a fresh review of the remaining sources.

After native intent authorization, each investment cycle derives a fresh holding wallet, investment wallet and confidential identity. Payouts wait for authenticated credit from every source in the batch. Across those credits, wallet 1 receives floor(total confirmed private input / 10); wallet 2 receives the rest, before their independent payout fees. Wallet 1's deliberate holdings do not count as wallet 2's exit dust and must not be swept to complete that exit.

## Implementation map

- `src/services/wallet/usdcBalance.ts`: pinned chain/token balance reads, exact base-unit strings, timeouts and malformed-response rejection.
- `src/services/wallet/earnWallets.ts` and native stored signer: immutable profile/pair preparation after passkey approval, backup-compatible derivation, restore reconciliation gate.
- `src/domain/earn/policy.ts` and `lifecycle.ts`: integer fee/reserve formulas, split conservation, cost ledger, uncertain-operation and exit policies.
- `src/services/earn/`: real read-only readiness, authenticated private balance, independent native quotes and final exit snapshots. An aggregate private balance is not operation-scoped settlement evidence.
- Backend `adapters/earn/`: dynamic isolated fork simulation and unsigned destination deposit planning. Backend `adapters/pimlico/source-funding.ts`: address-only source sponsorship preparation, conservative ceiling fee cap, bounded approval and fresh-state validation. No preview signs or broadcasts.
- Native `core/src/earn_execution.rs`: constrained Ethereum allowance/deposit/full-redemption transactions. The core derives only the investment role, constructs canonical pinned Morpho SDK router calldata, binds native review and revision, and requires fresh native state before signing.
- Native Rust `earn_sponsored.rs`, `earn_ethereum_liquidity.rs`, and `earn_payout.rs`: source/Robinhood token sponsorship; exact native USDC permit/Fusion order; constrained USDC/native ETH returns; exact independent confidential payouts. No generic digest, calldata, key or signature authority is available to JavaScript.
- Android native engines/journals: passkey-bound review; encrypted signed-before-submit records; exact saved-byte recovery; canonical receipt/finality checks; authenticated operation-specific credit. Pending Ethereum liquidity transactions support separately reviewed same-nonce cancellations and retain every candidate until the finalized winner is known.
- `features/earn/`: source funding, two independently authorized payout roles, Ethereum funding/investment/exit and Robinhood token-sponsored investment/exit progress. All default execution adapters are real native/provider adapters; functional tests inject services only at those boundaries.

The initial destination namespaces are `m/44'/60'/143'/destinationChain'/role`, with role 0 holding and role 1 investing. The separate confidential identity is role 2. Cycle zero keeps that historical derivation. New cycles use a monotonically allocated native cycle index. Each requested exit allocates a new public receiving address, saved before execution and reused on retries; it never returns to the original funding account. The encrypted catalogue and backup retain cycle/receiver relationships. Restore never clears the spending gate merely because local history is missing.

## iOS parity rollout

The first stage implements **Ethereum vault deposits and full redemptions** through the existing Earn screens and public contract. `earnVaultExecution` is available on supported iOS builds; source sponsorship, private payouts, Ethereum Fusion liquidity and Robinhood execution remain unavailable. This is not yet an end-to-end iOS Earn journey. The investment wallet must already have sufficient Ethereum USDC and ETH; the app does not bypass unavailable funding capabilities.

- `ios/Earn/EarnVaultEngine.swift` delegates exact proposals, review hashes and signing to the same Rust `earn_execution.rs` policy used by Android. The approved amount, owner, contracts, nonce, fees and deadline remain bound.
- `EarnVaultRPC.swift` reads chain 1 at a canonical block hash, rejects stale or reorganized snapshots and keeps all amount arithmetic in shared Rust U256 helpers.
- `EarnVaultJournal.swift` encrypts wallet-generation records and commits signed bytes before broadcast. A failed submission remains locked and recoverable. Status reads never broadcast; explicit resume requires a fresh native review/passkey assertion and retries saved bytes exactly.
- `EarnVaultReconciler.swift` validates transaction fields, finalized canonical receipts, expected allowance/deposit/redemption events, shares and actual gas costs. A reorganization restores the pending lock. Approval and investment/redemption are separate authorizations; there is no automatic second transaction. After approval finalizes, both platforms give the unsigned router continuation a fresh five-minute deadline and native review. The operation identity, amount and finalized approval stay bound; gas limits and fee caps remain unchanged and are revalidated against fresh state. Signed router retries use their saved signing deadline and never refresh or alter signed bytes.
- Cancellation stops new signing but retains unresolved transactions. Restore keeps the existing recovery gate and starts a separate journal generation; it cannot infer that a missing journal means no past spend.

Remaining stages: source sponsorship and shared source reservations; private credit/payouts and cycle recovery; Ethereum liquidity/return/cancellation; Robinhood execution and Earn portfolio extensions. Before enabling another writer for the same Ethereum investment account, integrate its pending journal into a shared nonce lock. Independent per-engine locks are insufficient.

Verification for this stage: 51 Swift simulator tests, 148 Rust tests with strict Clippy, Android Debug/Release unit tests, 629 JavaScript tests across 76 suites with coverage, TypeScript, lint, formatting and iOS registration checks passed. The arm64 simulator app compiled successfully. Native tests exercise real Rust signing with injected RPC/storage failures; JavaScript tests mock the native boundary. Physical-iPhone passkeys and funded Ethereum execution remain untested. No mainnet transactions were sent.

## Runtime and deployment

The hosted native API is `https://gizu-backend.onrender.com`; JavaScript uses `EXPO_PUBLIC_API_URL`. JavaScript updates load through Metro in the development app; native API changes require rebuilding and installing the APK. Local backend changes do not alter Render until deployed.

For the requested pre-deployment phone test, `-PgizuEarnBackend=usb` builds Android debug with a fixed native `http://127.0.0.1:3000` backend. Set Metro's `EXPO_PUBLIC_API_URL` to the same origin and reverse ports 3000 and 8081 over USB. This is compile-time local testing; JavaScript cannot select a native endpoint. Omitting the property keeps the hosted backend; release always uses the hosted HTTPS backend. See [native USB setup](NATIVE_SIGNER_EARN.md#android-usb-backend-test-build).

The local server uses an ignored, permission-restricted `backend/.env` with provider credentials copied by name from the authorized research configuration and an isolated local PostgreSQL database. No research wallet keys or signing journals are imported. A new local-only durable recovery key is retained in that file; production must retain its own stable key. The qualified Aurora fee configuration and installed-certificate association remain required even when the backend runs locally. Publishing the frontend association can enable device signing without deploying the backend.

Render build commands and the pinned Linux Anvil runtime are documented in [backend deployment](../app-guide/BACKEND_DEPLOYMENT.md). The service root is `backend`; use `npm start` for the deployed build. Keep provider keys on the server: the existing `ONEINCH_API_KEY`, plus `AURORA_API_KEY` and `PIMLICO_API_KEY` for their respective paths. `ETHEREUM_RPC_URL` can select a qualified HTTPS RPC. `EARN_ANVIL_PATH` must point to a working server-side Anvil binary with pinned-fork access; missing simulation blocks that proposal. No Anvil process or provider key belongs in the mobile app.

The frontend service builds from `frontend` with `npm ci && npm run build`, publishing `dist`. The prepared `.well-known/assetlinks.json` adds this APK certificate and preserves the previous certificate. Verify its publication on `gizu.io`, particularly before new credential registration. Existing-wallet passkey access succeeded on the connected Android phone during the local test; this does not establish new registration or transaction authorization. Dashboard configuration and deployment credentials still need verification at deployment time.

## Provider qualification and remaining gates

Aurora's normal provider service fees are permitted by the handover; an application fee recipient is not. The inspected key returned a 4-basis-point `appFees` entry and referral metadata. Its beneficiary/commission policy is not yet qualified, so routing rejects it rather than treating an unknown collector as a permitted provider. This does not mean Aurora must provide a zero-fee service. See [Aurora API keys and fees](https://docs.intents.aurora.dev/getting-started/api-keys-and-fees.md).

The Android paths now include source funding and authenticated private credit, two independent payouts, Fusion permit/order execution, both destination vaults, and separately requested withdrawal/returns. Execution fails closed when provider qualification, simulation, gas, current native state or passkey association is missing. Publish the backend and verify the Android association before trying the deployed journey; a local implementation is not a live deployment.

Configure `EARN_AURORA_FEE_QUALIFICATION_JSON` with versioned route-specific provider collectors, fee bounds and explicitly verified referral terms, with zero Gizu/integrator commission. A legacy exact-2-bps/no-referral configuration remains supported. The inspected research key is not qualified. Also configure a durable 32-byte hex `EARN_GATEWAY_RECOVERY_KEY` on the server. Its AES-GCM envelopes recover the exact prepared quote/payout across server restarts and remain inside encrypted native storage. Keep the same key when restarting or deploying; changing it prevents recovery of outstanding preparations. No key is shipped in the APK.

Unsigned payout reviews may refresh authenticated evidence and, only after native proof that no signature exists, replace an expired quote within the same funding-role reservation. Signed or uncertain submissions retain their exact payload and nonce. Cancelling an unsigned payout review retains its original role reservation; explicitly refreshing that saved child enables a new native review, without allocating the role again. An expired sponsorship preparation may be explicitly discarded before any spending UserOperation is signed. Saved delegation authorization remains encrypted; discard does not revoke that authorization or broadcast it. Closing a screen locks authorization and discards late UI results; it does not cancel an external transaction.

Exit completion requires wallet 2's zero shares, explicit WETH reconciliation, authenticated credit for each expected return leg and fresh spendable residual strictly below 0.5 USDC equivalent (below 0.1 optimal). Public provider success, an aggregate private balance or a receipt alone is insufficient. Unknown submissions and reorganizations must be reconciled before a new operation can be authorized.

## Verification record

Use the npm scripts in `mobile/package.json` and `backend/package.json`; full checks must be rerun after integration changes. Isolated Ethereum and Robinhood fork checks have demonstrated exact SDK deposit/full-redemption calls and separately simulated returns. Reserve estimation uses disposable child forks and leaves the parent fork invested. This does not establish live resolver admission, paymaster sponsorship, Android passkey/device acceptance or iOS acceptance. Those earlier fork checks did not include an iOS build; the iOS parity rollout above records subsequent simulator verification.

No mainnet Earn operation has been sent during this integration. The user separately authorized the research-to-app funding transfer recorded below.

## Recovery and platform limits

Reopen Confidential earn and use the saved-progress controls before authorizing another operation. A saved source or return receipt first requires native authenticated private credit; payout delivery also requires an independently verified finalized destination transfer. Provider status alone never unlocks an uncertain spend. An expired signed Ethereum raw transaction may still confirm: use the explicit pending-cancellation review when the journal offers it and existing ETH covers the replacement gas fee. Both candidate transactions remain tracked.

Each investment has an immutable destination pair/profile. Previous cycles remain selectable for withdrawal and recovery, and a new investment allocates a fresh cycle. Restore without native history remains gated; missing journal data is not evidence that an old operation never spent. Automatic sibling-wallet top-ups, generic replacement transactions and WETH unwrap signing remain unsupported.

Android execution has native and screen-level test coverage. iOS enables only the Ethereum vault execution capability described above. The remaining execution capabilities stay unavailable; simulator checks do not establish device acceptance. Mainnet resolver admission, live paymaster acceptance, passkey ceremonies and the complete deployed phone journey require separately reported provider/device checks. No vault funds moved during implementation; the separately authorized app test funding is recorded below.

## Durable review and recovery decisions

- Independent payout quotes replaced joint hosted previews; do not send both
  destination addresses together merely to render a preview.
- Exit checks require refreshed native return evidence plus a canonical investment
  snapshot. Price token, ETH and WETH conservatively; a server residual flag alone
  cannot prove completion.
- Narrow only fresh unsigned payout deadlines to the validated quote expiry before
  hashing/review. Signed and recovered payloads remain immutable.
- React Native's installed abort implementation lacked `throwIfAborted`; adapters
  use a shared `aborted` check before requests and after asynchronous results.
  Regression tests reproduced the failure before the fix.
- Unsigned blocked previews use the existing funding panel, show real estimates
  only when available and disable authorization. They carry no signing binding.
- Executable quote recovery and native approval bind the versioned fee policy and
  exact fee breakdown. Preserve legacy signed authority and retry bytes.
- `EARN_AURORA_HISTORY_QUALIFIED` defaults false; qualification requires authenticated
  operation-specific evidence. Public SUCCESS and aggregate balance are insufficient.
- Read-only previews bind their maximum 60-second lifetime to the verified quote
  timestamp and separately enforce local freshness/expiry. This does not extend
  native spending deadlines.

## Historical verification summary

These results were recorded on September 30–October 1, 2026. They are not current
provider availability checks or newly executed tests.

| Milestone                | Evidence                                                                                                                                     | Boundary                                                                                                                                                                                |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| September 30 integration | Rust 65; Android 140 JVM and USB APK; backend 146 passed/3 optional fork skips; mobile 544 tests/64 suites with full checks and Doctor 21/21 | Existing-wallet login, Home and Earn form observed on Samsung; no complete funded Earn journey.                                                                                         |
| September 30 app funding | Finalized Monad delivery of 3.079262 USDC from 3.081997 input; difference 0.002735 USDC                                                      | Separate, explicitly authorized research-to-app transfer with a one-time 4-bps/referral exception; not Earn acceptance or general fee qualification.                                    |
| October 1 fee correction | Android 143; Rust 67; backend 154 passed/3 optional skips; mobile 548/64 suites and full checks                                              | Phone's 3-USDC unsigned review showed 2.98649 source, 0.00351 sponsorship estimate and 0.01 reserve; route/fee/history blockers kept its sole authorization control disabled. No spend. |
| October 1 multi-account  | Rust 140; Android 220; mobile 604/73 suites; backend 183 passed/3 optional skips; Doctor 21/21, Kotlin format and Swift syntax passed        | Mocked contracts and implementation checks, not live provider or device spending. No device detected at final build check.                                                              |

Details of the separately authorized transfer remain in the
[mainnet test record](../../research/confidential-earn/MAINNET-TEST.md#september-30-app-test-funding).
That record also limits what the successful receipt proves. Existing-wallet login
did not establish new passkey registration or all installed-certificate associations.

## Historical provider diagnosis

On October 1, 09:02–09:06 UTC, thirteen unsigned quote probes (saved research
requests, different amounts, dry/firm, slippage, deadlines, confidentiality and a
public control) returned Aurora HTTP 500 with upstream `1Click returned HTTP 521`.
Direct 1Click token/quote requests independently returned 521. This established an
upstream availability failure for those checks, not the infrastructure cause or
global outage scope.

Aurora incidents returned 13 entries including the HOT bridge; its relation to the
earlier `Quoting for this pair is not available` response remained unconfirmed.
Authentication returned 500, so earlier invite-only history denial remained the
latest entitlement evidence. Fee qualification was independently unresolved.
Sanitized responses and request settings remain in the
[provider diagnosis fixture](../../research/confidential-earn/fixtures/aurora-provider-diagnosis-2026-10-01.json).
No spending signature or transaction was sent during that investigation.

For a new test, recheck route availability, fee beneficiaries/referrals and
operation-scoped history entitlement. Do not infer today's service status from
this incident or weaken settlement rules to work around it.

## October 1 multi-account refresh and approval

Historical design snapshot; current UI refresh triggers may differ. The bounded
read policy and approval constraints below record the implementation decision.

All keys and the complete account/cycle graph stay in native device storage. The backend receives individual public operation proposals, never the ownership catalogue or signing keys. Existing components display the merged portfolio and per-source progress.

Ordinary app openings refresh encrypted snapshots with bounded work: token synchronization uses at most 80 balance reads and eight transfer-log calls per token shard, with HTTP batches of at most 40 calls. Public Monad USDC has one shared cursor. Other token/vault groups rotate (at most six groups per opening), and native gas observations rotate (at most eight accounts). Confidential Monad USDC rotates at most four identities within the wallet-opening read session; historical identities continue on later openings. Incomplete coverage stays explicit. Metadata and vault conversions are reused per asset. Unknown prices remain unvalued rather than being treated as zero or one dollar. Cache observations never authorize spending or prove operation settlement. Robinhood’s public RPC cannot read its older finalized contract state, so its display observers use current canonical samples with separately retained log checkpoints. Those rows identify their latest-block observation finality; transaction execution and settlement finality checks remain unchanged.

The native batch approval binds the wallet, journal generation, registry, selected owners, budgets, recipients, original requests and fee caps. It is memory-only and expires after the existing 15-minute signing-session window. Native signing still verifies exact final UserOperation/paymaster terms within those limits. Separate downstream payout, investment and withdrawal actions retain their own approvals. This batches source funding approval; it does not approve an unlimited or automatic full lifecycle.

The scalability bounds currently cover up to 8,192 public accounts and 256 Earn cycles per device. A cold/restored catalogue is synchronized incrementally. Funding review probes fresh candidate balances separately with a bounded search; an incomplete portfolio is not a promise that every account has been searched. Confidential valuation currently covers the configured Monad USDC asset only. Full iOS execution and live provider/device acceptance remain separate verification gates.
