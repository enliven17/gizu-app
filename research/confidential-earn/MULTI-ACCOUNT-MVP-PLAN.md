# Device-owned multi-account MVP

Approved scope: refresh when the user opens the app; share funding candidates between Swap and Earn; reuse the research fee policies; allocate fresh investment and withdrawal receiving accounts. No DeBank integration, server account registry, key export, automatic withdrawal, or live spending during implementation.

## Native contracts

- Account identity is the verified wallet/entropy, not whichever public account the UI displays. Accounts 0 and 1 and allocated public receiving accounts can fund; private identities and existing investment accounts are excluded from public funding selection.
- Native public source allocation uses exact integer budgets, current balances minus durable reservations, qualified per-source fee caps and retained reserves. Prefer one sufficient account; otherwise select account indices deterministically. No silent reduction of the requested budget.
- One combined native review and one passkey assertion authorize the selected sources in a funding batch. The memory-only approval binds the full plan, caps and recipients, expires after the existing 15-minute signing-session window and stops on changed terms; interruption requires fresh review of remaining sources. Swap and Earn retain separate per-source transactions and journals. A device-wide encrypted reservation ledger protects the selected owner/budget before signing and keeps uncertain signatures reserved until reconciliation.
- Existing derivations, addresses and journals remain valid. Earn cycle 0 retains the historical profile derivation. New cycles have a monotonically allocated native index and separate hold/invest/private addresses. Withdrawal recipients are fresh allocated public accounts, journalled before provider execution; retries retain the same recipient.
- All catalogue, cycle and reservation relationships stay encrypted on device. Native calls send only individual operation proposals to existing provider gateways. No private keys, entropy or account catalogue crosses the native bridge or backend.

## Implementation sequence

1. Integrate main's existing Swap implementation with Earn, preserving both native exports, backups, fee qualification and operation-scoped settlement gates. Verify merged suites.
2. Add native allocation and derivation tests: 7+8 funding a 10 budget, account 1 empty with account 0 funded, reservations preventing concurrent overcommit, insufficient-budget rejection, cycle separation and legacy address compatibility.
3. Persist a unified native account/cycle catalogue and shared reservation ledger. Update backup metadata without changing old backup decoding. Validate bindings against native derivation at creation and every signature.
4. Replace portfolio full rescans on normal openings with encrypted snapshots and bounded native incremental token-log synchronization. Cold/restore scans are batched; later refreshes re-read dirty accounts, checkpoint canonical blocks, retain stale snapshots on failures, and periodically reconcile. Token metadata/prices and vault conversion reads are shared per asset/vault. Native/confidential balances have their own freshness rules.
5. Connect existing Swap and Earn controllers to the native shared source plan, retain per-leg recovery, disclose budgets and fees, and require all selected funding credits before split payouts. Surface existing cycles and allocate withdrawal recipients on explicit withdrawal intent. Reuse existing components.
6. Run Rust, Android, backend and mobile checks; inspect native iOS compilation where tooling permits. Report provider/device limits separately. Do not send mainnet transactions, deploy or push.

## Acceptance evidence

- Native state/backup migrations accept both historical version-4 wallet layouts; all old addresses are unchanged.
- Refreshing unchanged accounts avoids an N-account balance scan; an external deposit to a previously empty account marks it dirty. Missing/reorganised/partial data never becomes a verified zero or signing authority.
- Native source eligibility and reservations cannot be overridden by JavaScript. A saved/unknown operation cannot be spent again through another feature.
- Separate investments and withdrawals never allocate the same destination; recovery reuses its originally saved destinations.
- A batch requires one passkey ceremony rather than one per funding account. Each signature remains native and constrained to the reviewed plan; approval cannot survive a changed recipient/amount/quote, wallet generation or session interruption.
- Exact fees still follow `APP-INTEGRATION-HANDOVER.md`; cache/provider quotes do not replace native checks or authenticated operation credit.

## Implementation and verification

The Android implementation shares native source discovery and encrypted reservations between Swap and Earn. Both funding flows now use one batch review/passkey rather than one ceremony per source. Existing cycles and source journals remain recoverable; new cycles and exit recipients use native monotonic allocation. No signing keys or full account catalogue are sent to the backend.

The mobile UI reuses its existing portfolio, funding and exit components. Token/position observations are incremental and bounded; unknown prices and incomplete coverage stay visible. Cold or restored accounts can require several openings to finish indexing. Current balances are reread independently before signing.

Latest verification counts and platform/provider limitations are recorded in [the mobile integration record](../../mobile/docs/CONFIDENTIAL_EARN.md#october-1-multi-account-refresh-and-approval). Mainnet spending, deployment and pushing are excluded from this implementation run.
