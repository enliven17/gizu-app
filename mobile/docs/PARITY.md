# Gizu product capabilities and parity

Consolidated 2026-09-24. Existing frontend-inspired mobile design is retained;
service availability differs by mode. Future work belongs in [PLAN](../PLAN.md).

The native-mode entries describe the Android app using the stored-wallet signer.
Platform acceptance and remaining migration work are tracked in
[the migration plan](SIGNER_MIGRATION.md). Explicit demo mode remains separate.

| Journey                         | Normal native mode                                             | Explicit demo mode                           |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Welcome/access                  | Native passkey create/open; Account 0 viewing session          | Simulated passkey access                     |
| Request access                  | Development mock; no real waitlist submission                  | Same mock                                    |
| Home                            | Actual Monad testnet MON balance, error/retry, address actions | Fixture portfolio and charts                 |
| Vaults                          | Read-only Monad mainnet catalog; no investment actions         | Search/filter, details, charts and sharing   |
| Swap                            | Coming soon                                                    | Coming soon                                  |
| Deposit                         | Receiving address/network/copy; no signing                     | Simulated transfer journey                   |
| Withdraw                        | <=0.1 MON, expected sender binding, native approval            | Simulated review/signing/result              |
| Activity                        | Account-filtered local outgoing journal only                   | Fixture activity                             |
| Account                         | Real address/copy, local preferences, disconnect               | Fixture profile and secondary pages          |
| Notifications/support/documents | Unsupported service actions guarded                            | Local fixture interactions, no real delivery |

Native sessions mount no mock financial providers. Unsupported balances/positions
are not zero-valued fictional holdings. No standalone wallet product UI is added.
Incoming and external history indexing is deferred. Core supports broader bounded
native diagnostics, but that does not expand the main-app product scope.

## Data and state boundaries

Local access is not backend authentication. Balances come from RPC; transaction
history is not a complete chain ledger. Unknown/pending native entries block new
transfers until reconciliation. Closing a screen cannot undo a submitted operation.
Legacy journal details remain missing when never recorded. Preferences are local,
not credentials; see [Account](ACCOUNT.md). Fixture transaction semantics remain
explicitly demo-only; see [Trading](TRADING.md).

## Product and interaction decisions retained from agent guidance

These feature-specific decisions live here so engineering instructions can remain
focused on reusable approaches. They supplement the journey statuses above.

- Access is passkey-only. Native and demo sessions are separate and memory-only.
  Restart/disconnect clears access; protected links cannot grant it. Developer UI
  previews are hidden from normal navigation and opened by explicit debug commands.
- Keep user-facing copy free of demo/simulated prefixes and repetitive banners.
  Preserve engineering mock provenance and labeled native share summaries; do not
  claim actual biometrics, credential creation, connectivity or settlement.
- In demo mode, use a session-scoped investment snapshot. Charts are performance indexes using
  fixture windows, not market history or executable quotes. Preserve old snapshots
  with stale/offline feedback after refresh failure; metadata comes from adapters.
- Demo vault search combines name, ticker, strategy, manager and risk. Preserve search/filter
  and chart selections across navigation; show Clear only when applicable. Advanced
  filters remain unavailable until specified. Share text without inventing a public
  URL or treating share-sheet dismissal as delivery.
- Hide all top navigator headers. Place accessible screen titles and Back controls
  in content, with safe direct-link fallbacks. Keep bottom tabs on main screens.
- Bottom navigation is a floating capsule over a transparent overlay. Reserve its
  measured height in scroll padding and pass touches through outside the capsule.
  Selection uses a centered measured circle, icon pop, outgoing fade (150 ms) and
  incoming fade (180 ms). Motion follows accepted navigation, retargets on interruption,
  honors reduced motion and does not replay on repeated selection.
- Prioritize balances or vault identity before metadata. Vault tiles show ticker,
  change, chart, name, TVL and APY; use one column for narrow/large-text layouts.
  Keep financial values readable and feature state intact during text-size changes.
  On Home, show vault summaries only when there are no holdings; invested users see
  their holdings without the duplicate discovery list. Vaults always owns the full catalog.
- Request access validates email, one investment range and at least one platform
  or Other. The range is not a commitment. Preserve answers on retry, lock controls
  while pending, ignore late results on dismissal and clear answers on reopening.
  Completion is user-dismissed. Its mock creates no real waitlist entry or session.
- Exchange keeps its route/deep link and is presented as Swap with the animated
  coming-soon heading. Demo buy/sell remains available from vault details; native buy/sell is unavailable.
  Deposit/withdraw remains available from Home, with explicit review, signing,
  submission, pending/unknown and result states.
  Notifications/account actions are implemented in M5; use a distinct sell tone without
  making successful sales look like failures. See `TRADING.md` for current rules.

- Welcome uses a fixed, non-scrolling screen with safe-area padding.
- Welcome animates only the word “Stealth”: a 360 ms opening tear after a short
  delay, then smaller 240 ms bursts approximately seven seconds apart. The large Gizu
  symbol stays still with a green light sweep over a five-second cycle. Artwork and headline form a centered group above the bottom actions.
  The symbol is omitted on short screens or enlarged text to prioritize content. Copy and access
  buttons remain steady and immediately usable. Both effects stop off-screen,
  in the background or with reduced motion; non-default text sizes keep native
  heading wrapping without decorative slices. This effect uses Reanimated and
  the shared SVG logo, with no new Lottie asset or dependency.

## Mainnet catalog

Native-mode Vaults reads the backend opportunity catalog on chain 143, with search,
protocol filters, pagination, APR and TVL. It does not change the wallet network
(chain 10143), expose deposit links or invoke signing. Unsupported demo risk, APY,
price and performance values are not synthesized. Details and investment execution
remain unavailable in native mode. Backend responses may be cached for five minutes.
