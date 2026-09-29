# Ethereum and Robinhood routes

Approved design: Monad USDC funds confidential USDC, split 10/90 into two destination wallets (same addresses on both chains). Only wallet 2 deposits. Ethereum uses the existing Pendle USDC vault and Fusion/native ETH flow. Robinhood uses Steakhouse USDG 0xBeEff033F34C046626B8D0A041844C5d1A5409dd and a token paymaster. No new helper, shared application fee address, or cross-wallet operation.

Implementation and verification:
- [x] Add explicit route commands, isolated routing/journal/confidential state, and shared destination credentials across chains. Preserve legacy Ethereum state.
- [x] Generalize routing asset/chain checks and enforce sequential confirmed payouts.
- [x] Implement Robinhood preview/deposit/withdraw/return/status/resubmit with persisted signed operations. Use provider estimates, full gas fee caps, local deposit/redemption simulation, and a calculated withdrawal reserve.
- [x] Verify exact deployed vault/EntryPoint/paymaster execution on a local fork; provider admission remains a distinct check. Test journal recovery, wrong-chain guards, fee changes and final residual gates.
- [x] Run regression tests and document both mainnet command sequences and evidence limits.

Rulings:
- Existing user design approval authorizes implementation; no further approval round needed.
- Work in the current workspace because the whole experiment is pre-existing untracked work.
- Candide public endpoints reject both Monad 143 and Robinhood 4663 (read-only checked September 29). Use Pimlico there; do not pretend cross-provider paymaster signatures are portable.
- Final acceptance is combined remaining native/token value below 0.5 USDC; target below 0.1. No finite withdrawal reserve guarantees arbitrary future gas prices or vault liquidity.
- Tests submit only to loopback forks. No live transaction or signed order submission.

Verification completed: 95 unit/regression tests; full Robinhood CLI fork cycle at block 75,777,651; exact captured-operation replay with identical gas usage and balances; separate fresh-wallet EIP-7702 authorization at block 75,775,406. Final Robinhood local residual 0.025111 USDG, zero ETH/shares. Prior Ethereum integration remains zero ETH/USDC/shares/WETH. Provider/settlement limits and command sequences are documented in TWO-ROUTES.md. No mainnet writes.

Updated test allocation: one saved Monad USDC balance snapshot reserves 70% for Ethereum and 30% for Robinhood, including source gas. This prevents the second test from taking 30% of the remainder.

Latest execution: Robinhood mainnet cycle completed; Ethereum held before funding on the affordability preflight. Existing Ethereum shares are now tracked and included in full redemption, with fork verification. Mainnet-discovered price-cache and quote-expiry/reuse fixes bring the suite to 103 tests. See MAINNET-TEST.md.
