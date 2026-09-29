# Native earn CLI implementation plan

> Implement inline using the executing-plans and test-driven-development skills. The user approved the tested native flow and explicitly requested integration; no mainnet submission during implementation.

**Goal:** Expose resumable native deposit, withdrawal, and USDC/ETH return commands in confidential-earn, ending only after both Aurora routes succeed and combined residual is below 0.5 USDC (optimal below 0.1).

**Spec:** NATIVE-GAS-VERIFICATION.md and the approved flow in this conversation.

**Architecture:** Keep source routing and legacy Circle commands intact. Dispatch `native-* 2` to an independent runner and private journal. Use fresh Anvil simulations of actual calls against pinned live state; native transaction signing/broadcast remains separate from the simulation process. Save every signed transaction/order before submission, reconcile pending work before signing another operation, and support same-nonce transaction replacement with fresh quotes.

**Constraints:** Only wallet 2 invests. No new contract, shared application fee collector, inter-wallet transfer, or joint destination order. Deposit gas +10%, future withdrawal gas +30% at 2x deposit fee; investment USDC buffer 0.05. Fresh return gas +10%, native sweep exactly measured 21,000 gas with fixed transaction gas price. Use native ETH, never WETH as gas. No fixed dollar gas budget. Public mainnet writes are for the user's later explicit commands, not verification here.

## Tasks

- [x] 1. Provider and journal boundaries: add tests for order payload/quoteId, unique nonce, unknown submission, atomic saves, exclusive lock, persisted transaction recovery, and complete-only-after-Aurora-success. Implement Fusion submission/status and Aurora status functions using published SDK/API shapes. Never expose credentials or signed payloads in console errors.
- [x] 2. Fresh planning: add pinned ephemeral-Anvil simulator (no private key), estimate exact sequential deposit/redemption calls, integrate market fee history and bounded fee horizon, account for existing ETH, and re-quote changed amounts. Test changed fees, insufficient balances, missing native output, and minimum-order/route refusal.
- [x] 3. CLI execution: implement native-preview/deposit/withdraw/return/status/reprice for wallet 2 with separate state. Persist intent before external writes; reconcile success, revert, unknown submission, expiry, nonce conflict, and replacement races. Prevent false completion on pending/refunded Aurora routes. Add injectable-boundary tests plus deployed-contract fork execution through the real runner.
- [x] 4. Verification and handoff: run the package suite, local integration harness, unsigned read-only preview where feasible, independent final review, and documentation with exact commands/recovery steps. Update example configuration and keep existing private state untouched.

## Review focus

- Crash after network submission but before response must not create a second order/transaction.
- Preview must not sign, submit, or mutate the mainnet wallet.
- Existing ETH/shares and changing balances cannot silently invalidate budgets or ownership.
- A prior same-nonce transaction winning must select its actual quote and receipt.
- Zero source balances with pending/refunded Aurora routes must never be called a completed cycle.

## Progress / rulings

Working in the existing shared checkout: earn is an existing entirely untracked experiment with private ignored state; moving/committing it would obscure the user's prior work. Changes stay scoped to confidential-earn. Provider submission quotes require a real quoteId; prior enableEstimate=false quotes do not provide one and are not submitted as orders.

Completed: package suite passed (74 tests); real CLI fork integration passed with zero ETH/USDC/shares/WETH; public provider writes intercepted locally and statuses explicitly mocked. Live unsigned withdrawal preview succeeded at Ethereum block 26,082,501. Two independent-review blockers (stale-lock race, funding freshness) were fixed and re-reviewed with no remaining blocker. Tiny Aurora native-input quote rejection remains a documented fail-closed eligibility limit. No mainnet transaction or signed Fusion order submitted.
