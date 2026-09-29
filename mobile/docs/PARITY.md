# Gizu product capabilities and parity

Consolidated 2026-09-24. Existing frontend-inspired mobile design is retained;
service availability differs by mode. Future work belongs in [PLAN](../PLAN.md).

The native-mode entries describe the Android app using the stored-wallet signer.
Platform acceptance and remaining migration work are tracked in
[the migration plan](SIGNER_MIGRATION.md). Historical fixture journeys remain in tests and the isolated UI playground;
simulated passkey startup has been removed.

| Journey                         | Normal native mode                                             | Test/preview fixtures                        |
| ------------------------------- | -------------------------------------------------------------- | -------------------------------------------- |
| Welcome/access                  | Native passkey create/open; Account 0 viewing session          | Simulated passkey access                     |
| Request access                  | Development mock; no real waitlist submission                  | Same mock                                    |
| Home                            | Actual Monad testnet MON balance, error/retry, address actions | Fixture portfolio and charts                 |
| Vaults                          | Read-only mainnet catalog, TVL charts and details; no signing  | Search/filter, details, charts and sharing   |
| Swap                            | Read-only live token catalog in development and TestFlight     | Read-only token catalog                      |
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

- Access is passkey-only. Native sessions are memory-only; simulated sessions are retained for tests.
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
  It matches the frontend glass capsule (19 px icons, inactive white/45) and enters
  from 60 px below with a 260/26 spring. Selection slides a
  measured neon pill with a 380/30 spring. Motion follows accepted navigation,
  retargets on interruption and does not replay on repeated selection; reduced
  motion skips the entrance and snaps the pill.
- Stack screens use a native 350 ms fade approximating the frontend's shift/blur
  fade (native stacks cannot blur). Modals keep the platform sheet transition;
  native back and swipe dismissal are unchanged.
- Prioritize balances or vault identity before metadata. Vault tiles show ticker,
  change, chart, name, TVL and APY; use one column for narrow/large-text layouts.
  Keep financial values readable and feature state intact during text-size changes.
  On Home, show vault summaries only when there are no holdings; invested users see
  their holdings without the duplicate discovery list. Vaults always owns the full catalog.
- Request access validates email, one investment range and at least one platform
  or Other. The range is not a commitment. Preserve answers on retry, lock controls
  while pending, ignore late results on dismissal and clear answers on reopening.
  Completion is user-dismissed. Its mock creates no real waitlist entry or session.
- Exchange keeps its route/deep link and Swap tab label. Development and TestFlight use `GET /v1/tokens` for read-only discovery: Ethereum (1), Monad (143), Robinhood (4663); Robinhood/RWA defaults, All/RWA filters, 300 ms search debounce and 20-item pagination. Network changes preserve search/category and reset the page. Two-column cards show token symbol/name, issuer, classification and 1inch listing, with contract addresses hidden; listing is not confirmation of Fusion availability. Quotes, balances, simulations, orders and signing are absent. Wallet network and signer capabilities remain unchanged. Missing configuration, backend 404/503 and malformed responses show unavailable/retry without fixture fallback. The public backend has not yet exposed the endpoint; service-mocked checks do not establish live readiness. Demo buy/sell remains available from vault details; native buy/sell is unavailable.
  Deposit/withdraw remains available from Home, with explicit review, signing,
  submission, pending/unknown and result states.
  Notifications/account actions are implemented in M5; use a distinct sell tone without
  making successful sales look like failures. See `TRADING.md` for current rules.

- Welcome follows the frontend Onboarding: a fixed, non-scrolling, full-bleed screen
  (safe-area padded) over the shared Skia wave field and an ink scrim. The wave renders
  at about 1.5 device pixels per point (smaller canvas scaled up, like the frontend DPR
  cap), pauses while Welcome is unfocused or the app is inactive, and shows a still
  frame under reduced motion. The large Gizu symbol artwork is no longer shown.
- The 46 pt headline enters as in the frontend: “DeFi in” at 150 ms, then “Stealth”
  and “Mode” at 0.85 s + 0.3 s per word (280 ms each, opacity and rise in place of
  blur), tagline at 1.5 s and the Get started action at 1.7 s. “DeFi” and “Stealth”
  use the shared glitch label; “in” and “Mode” are 55% white. The header is read as
  “DeFi in Stealth Mode”. Entrances do not block pressing, glitching stops off-screen,
  in the background or with reduced motion, and text sizes above 130% keep native
  heading wrapping without glitch slices. Negative display tracking applies on iOS only;
  Android mis-measures tracked text and can clip a wrapped word.
- Get started uses the frontend bubble-up fill (300/32 spring, snaps with reduced
  motion); Request access is a sentence-case text action with normal tracking.
- Access follows the frontend Auth layout: glitch heading, a full-width primary
  passkey button and a 60 ms section stagger (no footnote captions). Request access uses the
  frontend sheet look (36 pt top radius, glass fields, range tiles, platform pills) and
  a glass check tile on completion; it keeps its completion copy because the mock
  does not add anyone to a list.

## Mainnet catalog

Native-mode Vaults reads the backend opportunity catalog on chain 143, with search,
protocol filters, pagination, APR and TVL. Cards on Vaults and the Home preview draw a
sparkline from the latest 30 TVL records (`/v1/opportunities/:id/tvl-records`), loaded
lazily per card and cached per vault for the app session; a failed history omits the
sparkline, an empty one draws a flat line at zero. Tapping a card opens the browse-only
mainnet vault detail (`/v1/opportunities/:id`), ported from the frontend: glitch name,
total APR, TVL chart, stat tiles, about, how-to, tokens, details, tags and campaigns,
with loading and error/retry states. Like the frontend, the header offers an external
Deposit link to the protocol page (https only, opened in the browser). The app never
changes the wallet network (chain 10143) or signs for mainnet vaults, and has no
buy/sell/withdraw actions there. Unsupported demo risk, APY and price values are not
synthesized. Backend responses may be cached for five minutes.
