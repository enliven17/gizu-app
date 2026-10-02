# Implementation task: integrate Confidential Earn into the app

Use this as the next implementation task brief. This is a specification, not a claim that app integration is already implemented. Read the detailed [fee, UX, privacy and recovery handover](APP-INTEGRATION-HANDOVER.md) first.

## Outcome

Implement a reviewable, resumable user journey from Monad USDC through separate confidential payouts into a supported vault, followed by user-requested withdrawal and return to Aurora's confidential Monad-USDC asset. Show what the user can actually invest after budgeting execution, without hiding Fusion costs or treating reserved funds as spent fees.

Support these validated research profiles:

1. **Ethereum:** Pendle Ecosystem USDC vault; Fusion USDC → native ETH when needed, then native transactions for deposit, redemption and separate USDC/ETH returns.
2. **Robinhood:** Steakhouse USDG vault; Pimlico USDG paymaster and bundler for deposit, redemption and return.

Keep the source's Monad USDC paymaster separate from destination execution. Base/other chains require their own provider and lifecycle qualification.

## Read first

- [Detailed app handover](APP-INTEGRATION-HANDOVER.md): accepted policy, exact equations, UX copy, migration gaps, tests.
- [Mainnet results](MAINNET-TEST.md): chronology, receipts and caveats.
- [Ethereum completion evidence](fixtures/ethereum-mainnet-cycle.json) and [Robinhood receipts](fixtures/robinhood-mainnet-receipts.json).
- [Native CLI](NATIVE-CLI.md), [two-route setup](TWO-ROUTES.md), [package versions](package.json).
- [Mobile engineering instructions](../../mobile/AGENTS.md), [native signing design](../../mobile/docs/NATIVE_SIGNER.md), [product parity](../../mobile/docs/PARITY.md).
- Research code: [native planner](src/native-planner.mjs), [Fusion](src/fusion-bootstrap.mjs), [native engine](src/native-engine.mjs), [native context](src/native-context.mjs), [token policy](src/token-earn-policy.mjs), [token engine](src/token-earn-engine.mjs), [source paymaster](src/source-paymaster.mjs), [Aurora return validator](src/aurora-return.mjs).

Confirm whether the first delivery targets mobile, web, or both before making platform-specific changes. For mobile, extend the existing investment feature and **GizuStoredSigner**; do not resurrect the disconnected legacy signer.

## Required behavior

- Split confirmed confidential input **10/90**, before separate route fees; only wallet 2 invests. Display the actual net payouts. Preserve exact integer conservation.
- Deposit only after the user chooses a vault and reviews the current plan. Do not auto-withdraw immediately as the research test did.
- Show initial destination balance, exact investable amount, ETH purchase input/minimum output, deposit gas budget, withdrawal reserve, embedded Fusion overhead, liquid threshold, extra usable ETH and exclusions.
- Show fee prices in gwei with clear base/priority/maximum/actual labels and sample time/block. ETH amounts must remain separately labelled.
- Ethereum: full upper-middle sample of eight blocks' 25th-percentile tips; 10% deposit gas headroom, 30% withdrawal gas headroom, 2× withdrawal price reserve; temporary 0.05 USDC liquid amount. Preserve dynamic simulation and quote iteration.
- Include resolver economics in Fusion pricing, with the handover's provider gas estimate, headroom and profit model. Do not count the allowance again after including input-minus-net-output overhead.
- Robinhood: supported token-paymaster decoder, 10% fee-price headroom, 5% operation budget headroom and 2.6× simulated withdrawal cap. Validate real final sponsorship against approved limits.
- Re-quote withdrawal and Aurora return when they occur. Explicitly disclose that the initial budget excludes executable future return costs and cannot guarantee future gas/liquidity.
- Return unused ETH on Ethereum using the narrowly validated exact native sweep; reconcile stablecoin and ETH return legs independently.
- Require authenticated confidential credit and fresh final balances before closing the cycle. Final residual must be **<0.5 USDC equivalent**, optimal **<0.1**, with zero full-exit shares and explicit WETH handling.
- Track existing Ethereum shares only with explicit scope/approval; full withdrawal includes that old position. Do not imply that old principal is newly earned yield. Robinhood existing-share support is not established by this experiment.

## Constraints

No new helper contract, shared application fee recipient, fee before confidential routing for app sponsorship, wallet-to-wallet transfer, or joint transaction involving both destinations. Existing public providers are allowed. Never automatically fund a shortfall from the sibling wallet.

Do not copy `.env` private keys, Node `privateKeyToAccount`, raw-signing APIs, filesystem journals, or Anvil process spawning into the app. Native code owns secrets, semantic authorization, signing and protected recovery. Provider quotes are proposals, not signing authority.

Do not make test-only 70/30 chain allocation, 10-USDC source cap, shared cross-chain addresses or historical amounts into production defaults. Do not promise anonymity, guaranteed resolver fill, guaranteed inclusion or unconditional future withdrawal.

## Implementation work packages

### 1. Typed policy and lifecycle

Introduce asset-tagged base-unit types, versioned chain/fee policy, immutable quote proposals, explicit approval bounds, per-leg lifecycle and a cycle cost ledger. Keep original approval, actual costs and remaining-step estimates separate. Port integer equations with boundary tests before connecting signing.

Define ownership of cycle state, operation IDs, revision checks and serialization across devices. Store a coherent owner/chain/vault/asset/nonce binding. Do not permit duplicate source funding or payouts when resuming an investment step.

### 2. Read-only providers and simulation

Implement typed Aurora, Fusion, RPC, vault, bundler and paymaster adapters with source timestamps, stale-state handling and semantic validation. Choose production post-state simulation infrastructure; verify exact calls and future redemption, not a fixed gas estimate.

Preview must be side-effect-free with respect to signatures and broadcasts. Protect server credentials; avoid unnecessary provider metadata linking the source and both destinations. Provide stable structured errors for UI recovery.

### 3. Native authorization and durable execution

Extend the stored signer with constrained earn operations: necessary token approvals/vault calls, permit/Fusion order, token-sponsored UserOperation/delegation and exact return transfer. Validate all semantics natively, including minimum outputs and maximum spends. Persist approved payloads before broadcast and reconcile uncertain outcomes before retry.

Bind authorization to chain, owner, asset, spender, vault/recipient, amounts, deadlines, gas/cost limits and revision. Changed quotes outside bounds must return to review. Do not expose arbitrary message/digest signing to JavaScript.

### 4. User journey

Connect existing vault/portfolio screens through controllers and services. Provide deposit review, resolver/transaction progress, invested position, withdrawal review, return progress, actual fee ledger, residual result and recovery actions. Implement the handover's warnings, including no-return-quote and post-Fusion fee increases.

Closing the UI must not claim cancellation of an external operation. Reopening or restoring must rediscover unresolved activity. No fixture/demo adapter may service a live execution path.

### 5. Close research gaps before enabling affected paths

- Guard against provider-reported Fusion expiry before chain-proven terminal expiry/non-fill.
- Include WETH explicitly in completion.
- Replace approximate USDC-peg pricing with consistent fresh price conversion.
- Preserve already-spent Fusion costs after re-planning.
- Automate authenticated, operation-scoped confidential settlement reconciliation.
- Move source EIP-7702 authorization out of preview/context construction.
- Unify conservative token-cap rounding and supported paymaster-data validation.
- Validate fresh delegation, return top-up, restore without local history, replacement/reorg handling and supported device behavior separately from the happy path.

These are required fixes or explicit feature gates, not reasons to weaken the acceptance criteria.

## Verification and completion checklist

- [ ] Deterministic policy tests cover formulas, rounding, fee sampling, depeg prices, no double counting and residual boundaries.
- [ ] Adapter tests reject changed/malformed assets, recipients, calldata, fees, mode/flags, deadlines, native-output semantics and stale state.
- [ ] Full fork scenarios demonstrate deposit → user-triggered redemption → all return legs with correctly funded operations and unchanged wallet 1.
- [ ] Local resolver tests declare funding assumptions and distinguish execution from public resolver admission.
- [ ] Crash/unknown response/replacement/early expiry/reorg/restore/concurrent-device scenarios cannot duplicate a spend.
- [ ] Real-screen functional tests prove amount disclosure, changed-quote approval, status visibility, blocked paths and resumability.
- [ ] Native tests prove JS cannot change approved semantics; device results are reported separately for Android and iOS.
- [ ] Full exit requires authenticated return credit, zero shares, reconciled WETH and fresh residual <0.5; optimal <0.1 is reported truthfully.
- [ ] Required mobile checks pass; any unavailable device/provider checks are named with affected paths gated.
- [ ] Final delivery includes implementation map, policy versions, test evidence, known limits and operational recovery instructions.

Do not send mainnet transactions merely to complete this implementation brief. Prepare reviewable local/provider evidence first; a new mainnet run is a separately scoped user action.

## Historical benchmark, not a fixed quote

Ethereum completed with **zero ETH/USDC/WETH/shares**, returning **3.081997 confidential USDC**. Its owner-paid native gas was **0.000454298315072687 ETH**, excluding Fusion costs embedded in the swap. Robinhood completed with **0.044207 USDG** left, **zero ETH/shares**, returning **2.636109 confidential USDC**; actual destination paymaster charges totaled **0.079717 USDG**.

Use those receipts as regression evidence. Never use those dollar amounts as constants for another user, balance, block, vault or holding period.
