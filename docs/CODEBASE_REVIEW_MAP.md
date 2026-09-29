# Mobile codebase review map

Working inventory for reviewing Gizu one group at a time. This document groups
existing code; it does not propose physically moving every group into a new folder.

Baseline: 2026-09-29, `origin/main` at `2df4f6b`.
Review branch: `codex/mobile-review-plan`. The initial inventory was prepared on
`feat/confidential-swap` at `aa8ba59`; branch-only swap execution references have
been removed to match the main-based review scope. Recheck the revision and route wiring
before starting each review. Scope is mobile application code, its Android/iOS and Rust modules,
tests, assets, documentation and build tooling. Repository-level mobile CI and mobile
justfile recipes are supporting inputs. Backend, web, landing and research projects
are outside this review. External APIs are considered through mobile contracts only.

Paths in technical tables are repository-relative. In feature sections, `features/`,
`services/`, `domain/`, `application/` and `storage/` are under `mobile/src/`;
native paths are under the active stored-signer module.

## Scope and current entry points

| Area          | Responsibility                                                         | Start here                                                                                                                                |
| ------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Mobile        | Native application, access, wallet, discovery and swap UI              | [App.tsx](../mobile/App.tsx), [AppRoot.tsx](../mobile/src/application/AppRoot.tsx), [MainTabs.tsx](../mobile/src/navigation/MainTabs.tsx) |
| Native signer | Shared Rust core plus Android/iOS authorization, storage and execution | [gizu-stored-signer](../mobile/modules/gizu-stored-signer)                                                                                |

Current source distinctions that matter when reviewing:

- Mobile `Exchange` renders the read-only infinite token catalog `SwapScreen`.
  Confidential swap execution from the separate feature branch is outside this baseline.
- Native-session Vaults routes through `VaultsScreen` to `MainnetVaults`, then
  `OpportunityDetailScreen`. Its Deposit link opens the protocol website.
- Home, Activity and Transaction screens contain native-session and retained demo
  branches. Folder presence alone does not establish normal-app reachability.
- `gizu-stored-signer` is the active native integration. `gizu-signer` is preserved
  and excluded from mobile autolinking in `mobile/package.json`.
- Native wallet notifications use an empty service. Fixture inboxes and investment
  data are also retained for other paths and tests.

## 1. Groups by technical responsibility

These groups answer “what kind of code is this?” A feature can touch several groups.
The review column is a checklist of investigation topics, not confirmed defects.

| ID  | Group                                        | Locations and examples                                                                                                                                       | Review focus                                                                                                             |
| --- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| T01 | Composition and navigation                   | `mobile/App.tsx`, `mobile/src/application/`, `mobile/src/navigation/`                                                                                        | Provider ownership, session reset, route reachability and startup failures                                               |
| T02 | Screens and feature controllers              | `mobile/src/features/`                                                                                                                                       | Screen/controller boundaries, state transitions and error presentation                                                   |
| T03 | Shared UI, layout and visual system          | `mobile/src/components/{atoms,molecules,organisms,templates}/`, `mobile/src/theme/`, `mobile/src/animations/`, mobile assets                                 | Component APIs, NativeWind sizing, safe areas, accessibility and motion                                                  |
| T04 | Shared hooks and utilities                   | `mobile/src/hooks/useInfiniteList.ts`, `mobile/src/components/molecules/chart/path.ts`, helpers under `mobile/src/features/opportunities/`                   | Reuse, cancellation, pure transformations and ownership; avoid a catch-all utils folder                                  |
| T05 | Domain models and validation                 | `mobile/src/domain/`, Rust transfer policy                                                                                                                   | Identities, quantities, contracts and validation consistency                                                             |
| T06 | Services and external adapters               | `mobile/src/services/`, feature API helpers, native RPC clients                                                                                              | Timeouts, cancellation, response validation, errors and retry safety                                                     |
| T07 | State, persistence and caching               | Mobile providers, session state, `mobile/src/storage/`, `useTvlSeries.ts`, native wallet and transfer journal stores                                         | Ownership, lifecycle, cache invalidation, atomic writes and recovery                                                     |
| T08 | Native authorization and cryptography        | `mobile/modules/gizu-stored-signer/{core,android,ios}/`; public JS contracts in `domain/wallet/storedSigner.ts`, bridge in `services/wallet/nativeBridge.ts` | Secret boundary, passkey checks, authorization expiry, backup verification, approved payload binding and platform parity |
| T09 | Native UI and platform integration           | Active signer Android activities and `NativeStyle.kt`; iOS `UI/`, `Access/WalletCeremony*` and module registration                                           | Approval presentation, lifecycle, cancellation, document pickers and platform parity                                     |
| T10 | Tests and fixtures                           | Detailed breakdown below                                                                                                                                     | User-visible assertions, realistic boundaries, missing failure paths, fixture ownership and test cost                    |
| T11 | Build, configuration and delivery            | `mobile/app.config.ts`, `eas.json`, `src/config/`, `plugins/`, `scripts/`, native build definitions; repository mobile CI and justfile recipes               | Setup, identities, native generation, CI and release gates                                                               |
| T12 | Documentation, diagnostics and retained code | `mobile/docs/`, `mobile/README.md`, `mobile/AGENTS.md`, `mobile/src/development/`, `mobile/modules/gizu-signer/`                                             | Debug isolation, useful retention, obsolete instructions and duplication                                                 |

### T10: tests as separate review units

| Unit                           | Locations                                                                                                                            | What it establishes                                                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Mobile functional flows        | `mobile/tests/functional/` grouped by access, account, investments, lists, opportunities, swap, transactions, wallet and diagnostics | Screen/controller behavior with mocked external services and native boundaries                                              |
| Mobile unit and service checks | `mobile/tests/unit/`, `tests/services/`                                                                                              | Pure rules, adapter behavior and selected service interactions; inspect each test before calling it a live integration test |
| Mobile test support            | `mobile/tests/support/`; retained fixture services in `mobile/src/services/fixtures/`, `services/notifications.ts`                   | Fixture construction, render helpers and global mocks; review production imports separately                                 |
| Active native Android          | `mobile/modules/gizu-stored-signer/android/src/test/`                                                                                | Wallet store, envelope, backup, passkey and journal checks                                                                  |
| Active native iOS              | `mobile/modules/gizu-stored-signer/ios/Tests/`, `Package.swift`                                                                      | Authorization, storage, backup, transfer policy/journal and build-policy checks                                             |
| Shared Rust                    | Tests within `mobile/modules/gizu-stored-signer/core/src/`                                                                           | Derivation and transaction policy                                                                                           |
| Retired signer                 | Tests/examples/scripts under `mobile/modules/gizu-signer/`                                                                           | Historical implementation checks, not acceptance of the current signer                                                      |

## 2. Groups by product feature

These groups answer “which user journey does this code support?” Use the technical
IDs to select a smaller slice when a feature spans too much code for one review.

### F01 — Welcome, access and onboarding

- Mobile: `features/access/`, `application/SessionProvider.tsx`, `services/access.ts`,
  `services/earlyAccess.ts`, `services/wallet/{access,storedAccess}.ts`.
- Native authorization and backup are shared with F02/F03; inspect the public
  capability contract before evaluating onboarding UI states.
- Tests: functional `access/`, unit `wallet/storedAccess.test.ts`, native passkey tests.
- Review: welcome → passkey → backup-required → ready transitions, cancellation,
  recovery-required states, and distinction between local wallet access and API login.
- Technical groups: T01, T02, T05, T06, T08, T10.

### F02 — Wallet identity, balances and account ownership

- Mobile: `features/wallet/{WalletProvider,useWalletController}.tsx` / `.ts`,
  `services/wallet/{balance,nativeBridge}.ts`, `domain/wallet/`.
- Native: active module registration, Android `WalletStore.kt` and
  `AndroidWalletStorage.kt`; iOS `Storage/`; Rust `core/src/lib.rs`.
- Home and Account consume this state rather than owning independent wallets.
- Tests: functional `wallet/`, unit `wallet/`, native storage tests.
- Review: one source of wallet identity, address/balance freshness, account/session
  replacement, missing keys and storage corruption. Separate access from signing authority.
- Technical groups: T05–T08, T10.

### F03 — Backup, restore and security lifecycle

- Mobile: `features/account/WalletBackupAction.tsx`, access controller, stored-access service.
- Android: `BackupActivity.kt`, `BackupCodec.kt`, `PasskeyGate.kt`, `PasskeyVerifier.kt`,
  `CryptoEnvelope.kt`, `WalletFileCommit.kt` in the active module.
- iOS: `Access/` ceremony/passkey files, `Storage/BackupCodec.swift`,
  `DeviceWalletKey.swift`, `ProtectedFiles.swift`, `WalletCrypto.swift`.
- Tests: `access/stored-backup.functional.test.tsx`, native backup/storage/authorization tests.
- Review: verified save/reopen, original-passkey requirements, interrupted onboarding,
  restore overwrite rules, lifecycle invalidation and separately recorded device acceptance.
- Technical groups: T02, T05–T08, T10, T11.

### F04 — Deposit, withdrawal and native transfers

- Mobile: `features/transactions/{TransactionScreen,NativeTransaction}.tsx`,
  `components/TransferSheet.tsx`, `features/wallet/{useWalletTransfers,WalletOperations}`,
  `services/wallet/storedTransfers.ts`, `domain/wallet/{amounts,transfers}.ts`.
- Native: active Android `transfers/` and `rpc/`; iOS `Transfers/` and
  `Access/WalletCeremony+Transfers.swift`; Rust `core/src/transfers.rs`.
- Retained demo operations: `TransactionProvider.tsx`, `useOrderController.ts`,
  `services/transactions.ts`, `domain/transactions.ts`.
- Tests: functional `transactions/`, `wallet/stored-transfers.functional.test.tsx`,
  unit transfer/journal rules and native transfer/journal tests.
- Review: receive-address versus outgoing-transfer UX, exact review, amounts/fees,
  batch approval, persisted signed bytes, retry/resume and duplicate operation protection.
- Technical groups: T02, T05–T08, T10.

### F05 — Home, portfolio and Earn presentation

- Mobile: `features/investments/PortfolioScreen.tsx`, `InvestmentProvider.tsx`,
  `components/{PortfolioHeader,PortfolioActions,HoldingRow,VaultPreview,PerformanceUnavailable}.tsx`,
  `DataStatus.tsx`, `services/investments.ts`, `domain/investments.ts`.
- There is no dedicated `earn/` module or Earn tab in current mobile navigation.
  Treat Earn as the product grouping for yield discovery/positions across F05 and F06.
- Tests: functional `investments/`, unit investment/chart tests.
- Review: real balance versus demo portfolio values, unavailable performance,
  preview loading, shared vault cards and eventual position ownership.
- Technical groups: T01–T07, T10.

### F06 — Vault discovery, details and protocol integration

- Mobile: `features/investments/VaultsScreen.tsx` dispatches to
  `features/opportunities/`; `domain/opportunities.ts`, `services/opportunities.ts`,
  `components/organisms/VaultList.tsx`.
- Retained demo details: mobile `features/investments/VaultDetailScreen.tsx`, `detail/`,
  `useVaultDetailController.ts`.
- Tests: functional `opportunities/` and service/domain opportunity tests.
- Review: protocol/search filters, infinite catalog versus bounded Home preview,
  identity, TVL cache, data freshness, external Deposit links and execution boundaries.
  Review API contracts at the mobile adapter boundary; backend implementation is out of scope.
- Technical groups: T02–T07, T09, T10.

### F07 — Token discovery / Swap catalog

- Current tab: `features/swap/SwapScreen.tsx`, `useTokenCatalog.ts`,
  `features/swap/components/TokenCard.tsx`, `domain/tokenCatalog.ts`,
  `services/tokenCatalog.ts` and the shared infinite list.
- Tests: functional `swap/` and service token-catalog checks.
- Review: network/category/search filters, stable identities, pagination, loading,
  cancellation, response validation and listing-status copy.
- Quoting, signing and swap execution are outside this main-based catalog flow.
  Revisit its scope if the confidential-swap feature branch is merged later.
- Technical groups: T01–T07, T10.

### F08 — Activity, operation history and notifications

- Mobile: `features/investments/{ActivityScreen,NativeActivity}.tsx`,
  `features/wallet/WalletHistoryRows.tsx`, transaction feedback/link components,
  `features/notifications/`, `services/notifications.ts`.
- Native transfer journals supply the local operation history.
- Tests: functional `notifications/`, `transactions/`, wallet tests and native journals.
- Review: local outgoing history coverage, restart reconciliation, timestamps,
  unresolved statuses, empty native inbox and future incoming/indexed-history contract.
- Technical groups: T02, T05–T08, T10.

### F09 — Account, settings and preferences

- Mobile: `features/account/`, `domain/preferences.ts`, `storage/preferences.ts`,
  `services/clipboard.ts`, `services/fixtures/profile.ts`.
- Tests: functional `account/`, unit preferences and shared account test support.
- Review: persisted versus display-only preferences, address copying, disconnect,
  backup links, static content and account scoping.
- Technical groups: T02–T07, T10.

## Review sequence and tracking

Start with T10 (tests) and T04 (hooks/utilities): they provide useful context for
later changes. Then review shared UI and the active feature flows in small slices.
Security-sensitive signer work should remain its own review, with native verification.

| Order | Review slice                                                  | Status      | Output to record                                               |
| ----- | ------------------------------------------------------------- | ----------- | -------------------------------------------------------------- |
| 1     | T10: test layout, fixtures and assertions                     | Implemented | [Findings and implementation](reviews/T10_MOBILE_TESTS.md)     |
| 2     | T04 + relevant T06: reusable hooks, helpers and HTTP adapters | Not started | Ownership, duplication, cancellation and contract improvements |
| 3     | T03: shared components, templates and theme                   | Not started | Component boundaries, layout/accessibility improvements        |
| 4     | T01 + F01: composition, navigation and access                 | Not started | Reachability map, provider/session simplifications             |
| 5     | F05 + F06: Home/Earn and vault discovery                      | Not started | Demo/live separation, catalog/detail/cache changes             |
| 6     | F07: token catalog and Swap UI                                | Not started | Active-route decision, discovery reuse and contract gaps       |
| 7     | F02 + F03: wallet storage, authorization and recovery         | Not started | Security invariants and platform parity findings               |
| 8     | F04 + T08/T09: native transfers and authorization             | Not started | Approval, persistence, lifecycle and retry findings            |
| 9     | F08 + F09: history, notifications and Account                 | Not started | Data coverage, preference behavior and state ownership         |
| 10    | T11/T12: mobile delivery, diagnostics and docs                | Not started | Parity decisions, tooling/documentation/retention changes      |

For each slice, record findings here or link a focused follow-up document:

1. Revision and exact scope inspected.
2. Current behavior and callers, including feature flags/session branches.
3. Confirmed issues with file/line evidence, impact and smallest useful change.
4. Candidate readability improvements separately from correctness/security defects.
5. Agreed changes, checks performed and remaining native/live validation.
6. Final status and commit reference when implementation is authorized.

Do not treat this inventory as a deletion list. In particular, preserve the retired
signer until their disposition is explicitly agreed.

## Verification of this map

Source inventory, mobile navigation/provider wiring, service implementations and
native directory boundaries were inspected. No application code
was modified and no runtime, security, native-device or live-provider acceptance
was performed. This is an index for subsequent reviews, not a full code audit.
