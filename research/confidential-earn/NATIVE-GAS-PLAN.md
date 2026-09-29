# Native gas cycle — local implementation plan

**Goal:** Test the user's deposit-time ETH purchase, vault deposit, reserved withdrawal, and freshly estimated Aurora return transfer. Final combined ETH + USDC residual after both Aurora return intents is below $0.50, preferably $0.10; the local target is exactly zero of both. ETH reserved while invested must be returned at the end.

**Design:** Keep confidential funding and the 20/80 payouts unchanged. Wallet 2 alone signs a Fusion USDC→native ETH order, then pays directly for existing Morpho SDK calls. At deposit time, simulate the actual deposit and the resulting full-share redemption. Add a smaller deposit margin and larger withdrawal margin, expressed as explicit gas/fee policies, never fixed USDC charges. After withdrawal, estimate both the Aurora USDC return and final native ETH sweep. Check their funding before transferring away the USDC, buy any necessary ETH shortfall, then return actual leftover ETH through a separate native-input Aurora intent.

**Scope:** Local foundations only. No live order submission, transaction broadcast, new helper, destination-to-destination transfer, joint order, or application fee collector. Native ETH is an explicit exit reserve, not silently classified as invested value. Future gas prices and vault liquidity cannot be guaranteed.

## Work

- [x] Add tested integer gas-budget calculations, quote freshness/funding gates, Fusion minimum-output sizing and settlement reconciliation.
- [x] Build native deposit/redemption using existing Morpho SDK contracts and gasless USDC permit/native-output Fusion orders.
- [x] Run actual deployed contracts on a pinned local fork: zero initial ETH and Fusion allowance; exact signatures and native ETH delivery; dynamic deposit/withdraw estimates; fresh return estimate.
- [x] Exercise larger balances, fresh allowances, higher later fees, inadequate funding, plus unit guards for expired quotes and underfilled settlement. Verify wallet 1 is absent, no paymaster charge, and exact asset/gas accounting.
- [x] Record repeatable results and distinguish local resolver pricing from actual provider quotes and Aurora off-chain credit.

## Verification boundaries

An impersonated resolver on a fork proves on-chain settlement, not market willingness to accept a small order. The supplied ONEINCH_API_KEY now obtains real unsigned provider quotes. Each successful cycle obtains a fresh advanced Aurora quote after withdrawal; only its deposit-address transfer executes locally. Aurora's off-chain credit and public Fusion order admission remain untested. See NATIVE-GAS-VERIFICATION.md for results and exact limits.

Use `eth_estimateGas` and actual sequential fork execution. Opcode traces are diagnostic only: gas includes intrinsic/calldata costs, cold/warm storage, state transitions, and refunds. Record estimates, signed limits, actual gas, fee caps and effective prices separately.

Margin policy is configurable and stress-tested, not a guarantee. Re-estimate before each real execution; refuse stale quotes and insufficient ETH. A larger later fee must trigger an explicit shortfall, not silently proceed or cap the market price.
