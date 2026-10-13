# Confidential vault deposit journey

- Date: 2026-10-11
- Branch: `fix/backend-deposits`
- Status: Approved; Android implementation in progress, live acceptance pending.

## Agreed outcome

Replace the technical Confidential Earn deposit page with one guided journey:
enter a USDC amount, review net amounts and costs, approve once with a passkey,
watch progress, and see the investment result. The first complete path is Monad
mainnet USDC to confidential USDC to Robinhood USDG, with 10% allocated to a fresh
holding wallet and 90% to a fresh investment wallet. Only the investment wallet
deposits into the Steakhouse vault. Funds remain invested until a separate user
withdrawal request.

The user approved this flow in chat. This document defines its execution and
recovery boundaries for implementation review.

## Existing behavior and cause

`mobile/src/features/earn/EarnScreen.tsx` mounts private balance, source funding,
preflight, and execution panels together. Source funding nests the independent
payout panel. Their independent state owners expose all stages and several
refresh, review, authorization, and recovery controls at once.

On Android, `GizuStoredSignerModule.kt` separately authorizes wallet preparation,
confidential reads, funding batches, each private payout, and sponsored execution.
`EarnFundingBatchApproval.kt` binds multiple source funding operations, but grants
no authority to execute later payout or vault operations. A visual redesign alone
cannot deliver the agreed approval behavior.

The backend Robinhood deposit planner reads a real funded balance. Its existing
plan must not be repurposed as a fabricated executable plan for an empty wallet.

## Scope

- One guided deposit entry for catalog vaults, retaining the selected vault.
- One native passkey confirmation for an uninterrupted Robinhood deposit that
  stays within approved limits. Wallet setup and related confidential reads are
  included in this journey, without separate preparation or read prompts.
- Reuse existing source selection, shared Swap/Earn reservations, fee formulas,
  native signing engines, simulation infrastructure, and operation journals.
- Support multiple funded source accounts. Do not default to spending account 0
  or account 1 when another eligible source is required.
- Keep existing investments, addresses, withdrawals, and recoverable operations
  usable. Do not allocate a new investment into an old investment account.
- Keep the new hosted backend URL `https://gizu-app.onrender.com` in all relevant
  app configuration and native endpoint selection.

The Robinhood path is the first acceptance target. Ethereum deposits use the same
page layout and retain their validated execution policy; they must not silently
run Robinhood logic or claim single-approval capability before it is implemented
and verified for Ethereum. Featured vaults without a supported deposit remain
informational. No Solana, new vault signing policy, or catalog expansion is added.

## Screen design

Reuse the existing screen template, vault identity assets, semantic typography,
surfaces, buttons, and amount input styling. Replace the collection of technical
panels in the deposit entry with one screen and one controller. Do not create a
second parallel deposit implementation or duplicate existing atomic components.

| State       | Visible content                                                                                                                 | Primary action                                      |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Amount      | Vault name and protocol icon, USDC amount, available eligible USDC, short 10/90 explanation                                     | Review deposit                                      |
| Preparing   | Current preparation step, inline loading state                                                                                  | None                                                |
| Review      | Total USDC budget, estimated held USDG, estimated invested USDG, minimum outputs, fee limits, liquid withdrawal reserve, expiry | Confirm deposit                                     |
| Authorizing | Native review and passkey ceremony; app prevents duplicate submission                                                           | None                                                |
| Running     | Compact progress list, current step, settled amounts as available                                                               | None                                                |
| Paused      | Specific reason, completed steps, funds' last verified location                                                                 | Resume or Review changes, according to native state |
| Invested    | Verified invested amount and wallet 1 holding, saved investment reference                                                       | View investment                                     |

The destination chain is available in details, rather than acting as a user
selection filter. The selected vault supplies its fixed profile. Full addresses,
transaction identifiers, source allocations, itemized provider costs and native
delegation disclosures are available under Details. Mandatory approval limits
remain visible in the review; important costs are not hidden behind Details.

Do not display manual readiness checks, private balance reads, individual payout
buttons, redundant refresh buttons, or withdrawal/return controls during deposit.
Existing withdrawal controls move to the saved investment view, preserving their
native approval and reconciliation requirements.

Input changes invalidate the review. Disable confirmation during preparation,
after expiry, and when a route or required provider qualification is unavailable.
An unavailable balance is not zero. Blockers use actionable product language,
with diagnostic codes in Details. An uneconomic small amount is explained before
source spending, rather than allowed to fail at a later route leg.

## Wallet allocation and ownership

An explicit Review deposit action may allocate an unsigned, prepared cycle in
native encrypted storage. This action creates exactly two destination wallets
plus the cycle's confidential identity, using the existing verified wallet secret
and derivation rules. It does not sign a transfer or move funds and needs no
separate passkey ceremony. Repeated taps, editing an unsigned review, retries, or
reopening that draft reuse its allocation. A new investment uses a fresh cycle.

Keep wallet secrets, derivation, complete account ownership and operation
relationships on the device. JavaScript receives public display data and bounded
operation results only. Backend/provider requests expose only the identities
needed for that individual quote, simulation or operation; they do not upload a
complete user account directory. Never migrate research private keys into the app.

Old journals and derivation versions remain readable. An abandoned prepared draft
does not make a funded account reusable for another investment. Backup restoration
requires reconciliation of existing activity before further spending.

## Amounts, previews and approval limits

The amount entered is a total source USDC budget, including bounded source gas
and the retained source margin. Apply the current research source formula and
0.01-USDC margin through existing shared fee rules. Retained funds are not fees.

The split is based on authenticated, operation-specific confidential credit after
source costs: `hold = floor(totalCredit / 10)` and `invest = totalCredit - hold`.
Preserve the existing native cumulative-offset allocation for multiple sources
so rounding cannot distort the aggregate split. Each source keeps its own credit
proof, payouts, transaction and recovery journal. Multiple sources can therefore
produce more than two public payout transactions; the user still receives exactly
two destination wallets. Do not combine destination wallets into one transaction.

The two USDG route outputs are net of their respective quoted costs. The investment
wallet's entire 90% allocation is not represented as the vault deposit: its USDG
operation budget and withdrawal reserve remain liquid. Preserve the Robinhood
10% fee-price headroom, 5% operation-budget headroom and 2.6-times simulated
withdrawal reserve from the current research policy. No unqualified app fee,
shared collector, or wallet-to-wallet transfer is introduced.

Extend the current quote/simulation adapters with an explicitly read-only
prospective preview for the not-yet-funded destination. Reuse the same fee math
and isolated simulation primitives, with hypothetical funding assumptions
labelled and bound to the preview. Do not weaken the real-balance deposit planner,
send preview calldata for execution, or treat stub sponsorship as live approval.
Use bounded individual requests rather than a backend-owned full journey record.

The upfront review must include fresh source terms, indicative net route outputs,
positive minimum outputs for each destination, a positive minimum vault deposit
and minimum share bound, per-stage fee caps, a total spending limit, and an expiry.
USDG and USDC amounts remain separate; cross-asset differences are not called a
USDC fee without a fresh price basis. Unknown fees are unavailable, not zero.
If fresh preview terms or safe approval bounds cannot be established, confirmation
is blocked before funds move. Historical mainnet receipts are reference evidence,
not current quotes.

After source settlement, obtain fresh exact payout quotes for actual credit.
After destination settlement, obtain a fresh real-balance deposit plan and final
sponsorship. Recheck every exact operation against the approved envelope and
existing native semantic validation. Smaller deposits or worse outputs outside
the approved bounds require a new visible review; they are never substituted
silently. Withdrawal simulation estimates a reserve only and executes no live
withdrawal.

## Single-passkey authorization

Add a deposit-specific native authorization envelope, building on funding batch
approval rules rather than using an unrestricted signing session. Native code
constructs and verifies the envelope and shows its final semantic review. One
passkey binds its digest to:

- Verified wallet, backup/journal generation, cycle, and selected vault profile.
- Exact two destination addresses and confidential identity.
- Eligible selected sources, their maximum budgets, and reservation membership.
- Source USDC asset/chain, destination USDG asset/chain, approved delegation and
  provider contracts, 10/90 rule, and permitted deposit-only operation kinds.
- Minimum leg outputs, minimum vault deposit/shares, maximum source spend and
  per-stage costs, reserve policy, quote validity rules, and expiry.
- Read-only confidential authentication needed for this cycle's reconciliation,
  including disclosure of provider-visible identity.

The grant is held inside native memory, scoped to this foreground journey, and
expires no later than 15 minutes after approval. It cannot authorize withdrawals,
returns, unrelated Swap operations, arbitrary calldata or unrelated history reads.
Backgrounding, locking, cancellation, process death or generation changes revoke
the ability to sign additional operations. Persist the review and progress, not
an automatically restorable active signing grant.

Sign each exact operation only when its dependencies are verified and its fresh
terms satisfy both the envelope and that engine's existing review validation.
Do not pre-sign unknown future transactions. Passkey verification approves the
bounded journey; it does not replace each transaction's cryptographic signature.
Keep each signed payload durable before submission, with separate operation
journals, receipts, revision checks and idempotency. Prevent replay and budget
reuse across stages and sources. Native code must reject JS attempts to broaden
the grant or call existing operation APIs as a shortcut around validation.

One confirmation is the normal uninterrupted path, not a promise that delayed,
expired, interrupted or changed terms can spend without a new approval. Resuming
unsigned work after revocation requires one review of the remaining journey and
a new passkey. Reconciliation and retry of an already durably signed, still-valid
payload follow existing engine rules; they never silently sign a replacement.

## Execution and recovery

The native coordinator owns the journey lifecycle and authoritative saved state.
JavaScript's controller displays public progress, starts an explicit review or
confirmation, and requests status/resume. It is not the authority for determining
credit, signatures, spending bounds or completion.

Ordered phases:

1. Load or allocate the prepared cycle, validate the selected vault, select
   sources and establish shared reservations; create the unsigned review.
2. Obtain one native semantic review and passkey grant.
3. Execute source funding operations independently; reconcile source receipts
   and operation-specific authenticated confidential credits.
4. Wait for all selected source credits before allocation, preserving existing
   batch-membership and cumulative-offset checks. Quote and execute each hold
   and invest payout separately, within approved bounds.
5. Reconcile payouts against the destination token, wallet and receipt. Require
   both legs to settle before the investment stage completes its preparation.
6. Plan and execute wallet 2's real funded deposit, retaining the simulated
   withdrawal reserve; validate actual receipt and vault shares.
7. Mark Invested only from verified journal/chain evidence and release only the
   reservations that are safe to release. Revoke further signing authority.

Poll using bounded attempts and backoff, without scanning every user account or
reauthenticating per poll. Use the current native account inventory and cached
portfolio for display; refresh only selected sources and active operations when
execution needs live data. No screen-level repeated all-account RPC scan is added.

The journal records journey ID/revision, approved envelope digest, child operation
references and public phase, alongside existing durable child journals. Never
persist raw keys in JavaScript or backend storage. Recovery derives completed
steps from the native journals and live provider/chain evidence, not UI memory.

If any source, credit, payout, or deposit result is uncertain, pause at that phase
and reconcile before further signing. A confirmed hold payout and a failed invest
payout stay visible separately; retrying cannot resend the hold. If terms change
after confidential funding, explain where funds remain and review only remaining
work. Cancelling local work cannot undo submitted funds. Closing and reopening
the screen resumes the saved cycle instead of creating another pair.

## Integration boundaries

- Refactor the existing Earn screen and panels into a guided deposit presentation
  and investment/recovery details; keep shared UI primitives and protocol assets.
- Add typed journey view models in `mobile/src/domain/earn`, native service adapters
  in `mobile/src/services/earn`, and one screen controller in the Earn feature.
- Add narrowly scoped prepare/confirm/status/resume operations to the stored
  signer bridge. Reuse current funding, payout, sponsored and vault engines.
- Implement native grants/coordinator validation on supported platforms. Android
  Robinhood is the funded device acceptance target. iOS must accurately expose
  unsupported capabilities until equivalent native support is implemented and
  verified; it must not fall back to fixtures or unrestricted signing.
- Extend backend prospective preview support separately from executable planning
  contracts. Test deployment/version compatibility: an old Render backend shows a
  clear unavailable state before funding, without falling back to old estimates.
- Update the app guide and capability documentation when behavior is implemented.

## Acceptance and verification

1. A vault Deposit entry starts with amount and vault identity; no technical
   panel wall or manual payout/withdrawal controls are shown.
2. Reviewing an unfunded cycle produces fresh indicative amounts and explicit
   native approval bounds without spending or extra passkey prompts.
3. One passkey authorizes the normal foreground Robinhood journey, including
   multiple sources. Native code signs child operations separately under the
   approved envelope. Wallet keys never cross the native boundary.
4. Mocked real-screen functional tests cover validation, quote failure/expiry,
   editing, rejection, duplicate taps, progress, changed limits, cancellation,
   partial payouts, investment success and reopening saved work.
5. Native tests cover modified destinations/contracts, excess fees/spending,
   below-minimum outputs/deposit/shares, wrong split/membership, repeated budget
   use, grant expiry/revocation, journal generation changes, process death and
   each stage's uncertain submission and recovery. Test legacy journal loading.
6. Backend tests cover prospective preview isolation, stale/unavailable provider
   data, insufficient economics, unchanged real-balance planning, and the same
   research fee math/reserve simulation. Forecasts never pass executable parsers.
7. Run the mobile required checks and affected native/backend checks; report
   device behavior separately from mocked and simulator tests.
8. Build and install the standalone Android APK against the hosted backend,
   preserve the installed app's signing certificate and data, and verify actual
   layout and approval count on the connected phone. Do not uninstall or clear
   wallet storage. Live mainnet spending needs the user's specific authorization;
   this design approval is not authorization to move their funds.

## References

- [Research handover](../../../research/confidential-earn/APP-INTEGRATION-HANDOVER.md)
- [Research task brief](../../../research/confidential-earn/APP-INTEGRATION-TASK.md)
- [Mobile engineering guidance](../../../mobile/AGENTS.md)
- [Native signer contract](../../internal/NATIVE_SIGNER.md)
- [Current app capability guidance](../../feature-plans/PARITY.md)
