# Gizu mobile

Expo SDK 57 development app for iOS and Android. Normal startup now uses native
passkey access and the existing Gizu tabs. Home shows Account 0's Monad testnet MON
balance; Account shows its address, copy, local preferences and disconnect.
Wallet secrets remain in the native signer. This is local wallet access, not
backend authentication; production and physical-iOS acceptance remain pending.

From welcome choose **Get started**, then **Continue with passkey**. New Android
wallets must save and reopen an encrypted backup before Home opens. Recovery needs
the file and original passkey. Vault services, notifications, fiat valuations and
performance history remain unavailable. Deposit shows the receiving address;
Withdraw uses native approval; Activity shows local outgoing history and explicit resume.
iOS wallet access is unavailable. Incoming/external activity is not indexed.

Run `npm run start:demo` for the historical M2–M5 fixture flows described below.
Those simulated balances/orders are isolated from native wallets.

## Prerequisites

- Node 24.15.0 and npm 11.12.1 (npm is the package manager).
- Optional workspace shortcuts: just **1.40.0** on PATH. The root justfile uses
  `sh` on macOS/Linux and `cmd.exe` on Windows. No Bash is required on Windows.
- Android: Android Studio, SDK/platform tools, an emulator or USB device and
  JDK 17. Configure `ANDROID_HOME` and `JAVA_HOME` for your installation.
- iOS: macOS, Xcode 26.4+ with an installed iOS simulator runtime, Xcode command-line
  tools and CocoaPods. Physical devices require Apple signing setup.
- Use a development build, not Expo Go, for native validation.

## Install and run

From the repository root:

```sh
npm --prefix mobile ci
npm --prefix mobile run android -- --no-bundler
# macOS only:
npm --prefix mobile run ios -- --no-bundler
```

These commands generate ignored native projects and build/install a development
client. After that, start Metro with `npm --prefix mobile start` and open the
installed development app. Rebuild after native dependency/config changes.
`just mobile-install`, `just mobile-android`, `just mobile-ios` and
`just mobile-start` are equivalent shortcuts.

Approved local identity: **Gizu Dev**, `com.example.gizu.dev` on both platforms,
URL scheme `gizu-dev`. These are development placeholders, not registered release
identifiers. `app.config.ts` rejects the EAS production profile. Development and
preview profiles exist in `eas.json`; hosted builds still need an explicitly
selected EAS owner/project and credentials. Nothing has been submitted or published.
System fonts and a solid-color splash avoid unlicensed frontend font assets.
Custom icons, fonts and launch artwork remain future product work.

## Commands

Passkey identity and manual domain checks are documented in
[PASSKEY_CONFIGURATION.md](docs/PASSKEY_CONFIGURATION.md). The frontend owns the
hosted association files; deployment does not happen from mobile scripts.
The [former P1 probe](docs/NATIVE_SIGNER.md#retired-javascript-probe) has been removed. Native mode uses
the native signer; raw PRF is never exposed to JavaScript. Rebuild older clients
to remove the old bridge and install the current signer.

Run inside `mobile/`, or use `npm --prefix mobile` from the root.

| Command                                                                                          | Scope                                                          |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- |
| `npm run typecheck`                                                                              | Strict TypeScript, including tests/config                      |
| `npm run lint`                                                                                   | Expo ESLint plus atom import boundaries; no warnings           |
| `npm run format:check`                                                                           | Non-mutating Prettier check                                    |
| `npm run format`                                                                                 | Explicit formatting write                                      |
| `npm test`                                                                                       | All unit and functional tests                                  |
| `npm run test:functional`                                                                        | Full screen-flow suite                                         |
| `npm run test:functional -- --runTestsByPath tests/functional/access/access.functional.test.tsx` | Focused journey                                                |
| `npm run test:coverage`                                                                          | All tests and full-source coverage thresholds                  |
| `npm run doctor`                                                                                 | Expo project and dependency health; network access required    |
| `npm run check`                                                                                  | Typecheck, formatting, lint, Doctor and complete test coverage |
| `npm run export`                                                                                 | Compile iOS/Android JS and bundled assets; not a native build  |
| `npm run prebuild -- --no-install`                                                               | Generate ignored iOS/Android projects                          |
| `npm run hooks:install`                                                                          | Opt-in repository hook setup; refuses to replace other hooks   |
| `npm run precommit`                                                                              | Check changed mobile files without rewriting them              |

`npm run format:kotlin` formats maintained stored-signer Kotlin (including tests).
`npm run format:kotlin:check` checks it without rewriting and runs in Android CI.
Both require JDK 17 (`JAVA_HOME` or Java on PATH); the first run downloads the
checksum-pinned ktfmt 0.54 JAR into the OS temporary cache. Generated bindings and
the disconnected legacy signer are excluded. Kotlin uses ktfmt's Google style.

`just mobile-check` delegates to `npm run check`. CI runs it on Linux and Windows,
then separately compiles Android Debug and an unsigned iOS simulator build.
Configure these jobs as required branch checks in repository settings to enforce
merge protection; the workflow alone cannot change branch protection.

Pre-commit checks formatting/lint for staged paths using working-tree contents;
CI checks the committed revision. Run affected tests during development. Installing
hooks is explicit because this repository contains independently managed apps.
Husky on Windows requires Git for Windows (including its `sh`).
Formatting: two spaces, semicolons, double quotes, 100-column width, LF endings.

## Structure and testing

`src/application` composes startup/providers; `src/navigation` owns typed routes;
`src/features` owns screens; `src/components/atoms` and `templates` hold reusable UI.
Add molecules/organisms when meaningful reuse exists. Colors have one source in
`src/theme/colors.json`, consumed by Tailwind and native navigation.

Functional tests render real screens, navigation and session/controller logic.
Services are injected to test loading, rejection, failure, retry and cancellation;
unavailable native animation/linking boundaries are mocked. Tests also cover cold
and runtime protected deep links, modal cancellation, tabs and disconnect. Unit
tests cover render-error recovery and disabled actions.
Follow [AGENTS.md](AGENTS.md) for permanent testing and architecture policy.
Initial coverage floors are 80% statements/functions/lines and 70% branches,
based on this small foundation's measured coverage; include all source files and
raise floors as the app grows. These tests do not verify native gestures, keyboard
presentation, real biometrics, network operations or on-chain settlement.

See [docs/FOUNDATION.md](docs/FOUNDATION.md) for version decisions and the validation
record, and [docs/PARITY.md](docs/PARITY.md) for the frozen product scope.

## Portfolio and vaults

All M3 values come from mobile-local typed mock adapters. Portfolio totals sum
integer cents; chart samples are synthetic performance indexes, never trade prices.
Period buttons select deterministic 1D/1W/1M/1Y/All fixture windows. Search combines
case-insensitive name/ticker/strategy/manager matching with the selected risk band.
Advanced filters are explicitly unavailable. Vault sharing opens the native share
sheet with a labeled demo summary and no fabricated public URL.

Refresh preserves the previous snapshot on failure and labels stale/offline data.
An empty portfolio, missing vault and empty activity have explicit states. Service
adapters can inject those states in tests; no real network or OS connectivity is
inferred. Disconnect clears the snapshot and invalidates pending requests.

Home shows the vault-summary discovery list only when the account has no holdings.
Accounts with holdings see their holdings list without the duplicate vault summaries;
the full discovery catalog remains available from the Vaults tab.

Notifications, buy/sell and deposit/withdraw are identified by availability notes.
They do not simulate a successful operation.

Balance and vault price lead their screens; demo disclosure remains visible while
its timestamp expands on tap. Refresh uses a quiet action. Search/risk filters sit
near the top and Clear filters appears only when needed. Content Back preserves the
previous screen and falls back to the relevant tab for direct entry. Settings →
UI preview demonstrates shared actions, metrics, filters and feedback states.

The iPhone 17 Pro / iOS 26.5 development app was inspected at standard and enlarged
text sizes, including native sharing and software keyboard search. Smaller native
displays, VoiceOver, reduced motion, gestures and Android QA remain pending; see
the foundation record for the exact scope.

All top navigator bars are hidden, including access and modal screens. Each screen
owns its content title; detail/access screens provide a scrolling Back action and
the wallet picker retains Cancel. Bottom tabs remain available on main screens.
The shared Screen template applies safe-area insets and keyboard spacing directly.

## Frontend design parity (M3.2)

The interface now uses layered rounded surfaces, compact vault tiles with sparklines,
change badges, grouped holdings/terms/account rows, paired access cards and a floating
bottom-tab capsule. All top navigation bars remain hidden. The capsule floats over a
transparent overlay, with its measured height reserved in scroll-content bottom padding
so the last items can scroll clear of it. Narrow/large-text vault layouts use one column.

User-facing demo banners and prefixes are removed. The app still uses isolated mock
services and memory-only sessions; this visual update adds no live wallet, signing,
market feed or backend. Share payloads retain fixture provenance. M4 enables mock
trading/transfers; M5 adds account pages, preferences and the in-app inbox. Timestamp details,
error/retry and stale/offline feedback remain available.

System fonts are used because no mobile redistribution licence was found for the
frontend Helvetica assets. Decorative artwork is static and supports reduced motion.
See docs/FOUNDATION.md for the exact native and automated validation record.

## Latest frontend reconciliation (M3.3)

Welcome now uses the Gizu logo and “DeFi in Stealth Mode” headline. Portfolio and
vault discovery use “Confidential vaults”; the Swap tab shows the animated coming-soon
presentation. Vault details provide buy/sell through M4 mock services. Access supports
passkeys only.

Request access opens a guest form with email, investment range and platform choices.
Its isolated mock service sends and stores nothing and does not grant access or
create a real waitlist entry. Functional tests cover validation, submission, retry,
duplicate prevention and dismissal. Notifications use the M5 mock inbox.

## Trading and transfers (M4)

Home opens Deposit/Withdraw; vault details open Buy/Sell. The Swap tab remains a
coming-soon presentation. Every available operation requires amount validation and quote review. After
submission, Check status reconciles the same operation; closing the modal does
not cancel it. Home and Activity can reopen status. The session-scoped mock ledger
updates cash, units and activity only on confirmed responses and resets at sign-out.

See [docs/TRADING.md](docs/TRADING.md) for exact fee, minimum, lockup, rounding,
scenario and dismissal rules. These interfaces are mock contracts, not production
API specifications or real wallet/signing integrations.

## Account and notifications (M5)

Home's notification button opens the inbox with read/unread and mark-all controls.
Account opens passkey/signing information, push-alert preferences, currency,
statements, contact desk and disclosures. Copy address uses the native clipboard.
Only non-sensitive preferences persist in AsyncStorage; explicit disconnect clears
this account's preferences and all session state. USD is the only supported display
currency. Recovery, push delivery, FX, document downloads and support channels are
explicitly unavailable pending their integrations. Real passkeys are next.

See [docs/ACCOUNT.md](docs/ACCOUNT.md) for availability and persistence rules.
M5 adds native storage/clipboard modules: rebuild an existing development client
with `npm run ios` or `npm run android` from `mobile/` before testing this version.

## Signer migration and developer diagnostics

The old Gizu signer is preserved but disconnected from app access, diagnostics and
native autolinking. `npm start` opens the existing app. Android development wallets
require native save-and-reopen backup verification before entering Home. Account
includes backup management; Withdraw and Activity use native approval and history. iOS signing is
unsupported during this migration. No fallback creates a demo or legacy wallet.

Use `npm run start:demo` explicitly for fixture flows. The UI playground remains:

    npm run debug:ui -- --port 8087

Legacy wallet/signer harness source remains for reference, but its launch commands
and native lookups are disconnected. Old debug selections fail explicitly.

Rebuild installed clients with `npm run android` or `npm run ios` to remove the
old native module; restarting Metro alone cannot remove native registrations.
Independent retained-core build/test commands remain `npm run signer:build` and
`npm run signer:test`; see the [retained module guide](modules/gizu-signer/README.md).
Follow the [migration plan](docs/SIGNER_MIGRATION.md) for the replacement contract
and remaining implementation.

## Wallet integration organization

Wallet adapters are grouped in `src/services/wallet/`; pure amounts, proposals and
public contracts live in `src/domain/wallet/`. Features depend on those interfaces,
not generated cryptographic bindings. The replacement contract is
`src/domain/wallet/storedSigner.ts`; the legacy module stays independently retained.

Replacement module verification uses `npm run stored-signer:test` and
`npm run stored-signer:build`; see its [module guide](modules/gizu-stored-signer/README.md).

For Android testing, rebuild with `npm run android`, then use the normal
app (`npm start`). Continue with passkey, save the encrypted backup, reopen it and
confirm the original passkey again. Only successful verification opens Home.
Cancel before verification and retry: the same wallet must resume backup setup.
Account offers **Save and verify wallet backup**. Recovery requires both the backup
file and original passkey. Restore is shown only for absent/unreadable local storage;
use another installation/device to test it without deleting this wallet.

After rebuilding, fund the new Account 0 with testnet MON only. Use the existing
Withdraw screen for a small transfer. Read the native review, approve and unlock
with the wallet's passkey. Activity **Refresh** only reconciles; **Review and resume**
requires a new native review/passkey prompt. Cancel stops unsigned remaining steps;
it cannot undo signed/submitted transfers. Pending or nonce-conflicting operations
block new transfers. Restoring a backup does not restore local transaction history.

Phase-3 guided checks were user-reported successful. Guided phase-4 cancellation, withdrawal, restart and resume checks were also
user-reported successful. Extended failure paths and second-device restore remain pending. Test restore only where the original
passkey is available and compare Account 0. The explicit `npm run debug:stored-wallet`
harness and retained legacy source remain separate from normal entry.

## Local vault catalog

Normal wallet mode lists Monad mainnet opportunities from the backend; wallet balances
and signing remain on Monad testnet. The catalog is read-only: no deposit, withdrawal,
or external deposit link is exposed. Explicit demo mode retains fixture vaults.

Start PostgreSQL with `docker compose up -d` in `backend/`. Set the backend local
`DATABASE_URL` to match `backend/.env.example` (port 54329), then run `npm run build`
and `npm start`. `GET http://127.0.0.1:3000/v1/health` should return status `ok`.

Development mobile defaults to `http://127.0.0.1:3000`. With an Android phone connected
by USB, run `adb reverse tcp:3000 tcp:3000` in addition to the Metro port forwarding.
For other hosts, set `EXPO_PUBLIC_API_URL` to a reachable backend URL and restart Metro.
Release builds require an explicit HTTPS URL. The public configuration contains no
Merkl API key; that stays on the backend.
