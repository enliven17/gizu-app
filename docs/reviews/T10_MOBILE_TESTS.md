# T10 — Mobile test layout, fixtures and assertions

Reviewed 2026-09-29 on `codex/mobile-review-plan`, revision `91e6ac1`.
Status: implementation applied; verification results recorded below.
Scope: mobile JavaScript test organization, shared helpers, representative functional
and adapter assertions, native test ownership and mobile CI wiring. This is not a
full native security audit. Existing package/lockfile edits were left untouched.

## Findings

### 1. P2 — Wallet tests can make unintended catalog requests

Evidence:

- [stored-backup.functional.test.tsx](../../mobile/tests/functional/access/stored-backup.functional.test.tsx), lines 30–34.
- [stored-transfers.functional.test.tsx](../../mobile/tests/functional/wallet/stored-transfers.functional.test.tsx), lines 79–86.
- [AppRoot.tsx](../../mobile/src/application/AppRoot.tsx) defaults to the real opportunity adapter.
- [setup.ts](../../mobile/tests/support/setup.ts), lines 43–46, resets calls/storage but does not guard network access.

Both suites render Home without injecting its opportunity service. Home's vault
preview can consequently fetch the configured API or the development localhost
endpoint. The tests can pass because catalog errors are handled by the screen and
their assertions concern wallet behavior. Results therefore depend on timing and
local configuration, contrary to the mobile no-network test rule.

Confirmed with a temporary Jest setup outside the repository: set the API URL to
`https://api.example.test`, intercept every fetch with a rejected mock, and assert
that no requests were attempted after each test. Seven of twelve tests across these
two suites failed that assertion, requesting `/v1/opportunities`. No network was
sent by this diagnostic. The ordinary suite still passes.

Smallest useful change: explicitly inject fresh `mockOpportunityService()` instances
in these render setups. Then add an unexpected-network guard for functional tests;
record attempts and assert after each test, since rejecting fetch alone can be
silently handled by the app. Adapter tests should continue to install their own
controlled fetch mocks. Do not globally reset mock implementations without restoring
the native boundary defaults.

### 2. P2 — Some active app journeys use the retired access adapter

Evidence:

- [nativeApp.functional.test.tsx](../../mobile/tests/functional/wallet/nativeApp.functional.test.tsx), line 6.
- [nativeHome.functional.test.tsx](../../mobile/tests/functional/investments/nativeHome.functional.test.tsx), line 5.

At the reviewed revision these suites imported `development/legacySigner/access`. They exercise useful real
screens, but their setup does not exercise the active stored-wallet access contract.
A regression in that contract can leave these broader Home/Account/navigation
journeys green. Dedicated stored-backup, stored-transfer and stored-access tests
already cover parts of the active contract; this is not a claim that it is untested.

Smallest useful change: provide a fresh stored-wallet native-boundary factory in
`tests/support/` and run active journeys through `createStoredWalletAccess`. Keep
real session/providers/controllers. Retain intentional retired-adapter checks in
clearly named development tests; do not delete or reconnect the retired module.

Implementation clarification: the former `wallet/wallet.functional.test.tsx`
tests `WalletDebugApp`, not the active app. Its legacy adapter is intentional; it
is now [development/legacyWallet.functional.test.tsx](../../mobile/tests/functional/development/legacyWallet.functional.test.tsx).

### 3. P3 — The large-grid assertion does not establish scrolling progress

Evidence: [infiniteList.functional.test.tsx](../../mobile/tests/functional/lists/infiniteList.functional.test.tsx), lines 172–192.

The test checks bounded mounted-card counts before and after a synthetic scroll.
Its post-scroll assertion also passes if the initial window never moves. It does
not establish that later cards or the final unpaired card are reachable.

Keep this as a bounded-render-window check. Add a distinct assertion that a later
range becomes rendered, supplying the layout measurements the test environment
needs. Verify final odd-row reachability separately. If the renderer cannot model
that reliably, record it as a simulator/device check rather than weakening the
assertion or claiming native scroll continuity from a synthetic event.

## Layout and fixture improvements

These are readability/ownership changes, not additional runtime defects.

| Area                            | Current situation                                                                                                   | Small proposed change                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction test classification | `tests/integration/transaction-service.test.ts` tests only `createMockTransactionService` and in-memory rules.      | Move to `tests/unit/services/demoTransactions.test.ts`; preserve its valuable idempotency, settlement and expiry assertions.                        |
| App render helper               | `tests/support/renderApp.tsx` takes five positional optional arguments and lacks catalog/wallet dependency options. | Use a named options object and explicit offline defaults for rendered app journeys; let individual tests override boundaries.                       |
| Async helper ownership          | `deferred()` lives beside `AppRoot` rendering and is imported by unrelated suites.                                  | Move to `tests/support/deferred.ts`, avoiding an app-composition import for a generic promise helper.                                               |
| Wallet fixtures                 | Wallet identity, ready/backup states and native bridge defaults repeat across suites.                               | Extract only repeated typed factories; return fresh mocks/state each time and retain unusual scenario setup beside its test.                        |
| Demo versus test fixtures       | `src/services/fixtures/` supports retained demo behavior as well as tests.                                          | Keep demo-owned data until callers are reviewed in F05/T12. Move only proven test-exclusive data into test support; do not broadly delete fixtures. |

Suggested layout keeps the existing feature structure:

```text
mobile/tests/
  functional/<feature>/             # Real screens/providers, mocked boundaries
  functional/development/           # Intentional diagnostic/retired flows
  services/                        # Real HTTP adapters, controlled fetch
  unit/<domain-or-service>/         # Pure rules and isolated service behavior
  support/
    renderApp.tsx                  # Named dependency overrides, offline defaults
    deferred.ts
    storedWallet.ts                # Fresh typed native-boundary/state factories
    opportunities.ts
    tokenCatalog.ts
    account.ts
    setup.ts                       # Native rendering stubs and isolation
```

Native tests should remain beside their owning modules. Android already reads
the iOS `Tests/Fixtures` resource directory for the common backup vector; do not
duplicate that JSON during cleanup. Swift's `WalletTestCase` already centralizes
storage setup and temporary-directory teardown. Cross-platform fixture decoding
does not establish physical-device passkey recovery acceptance.

## What to preserve

- Real user-flow tests with role/label queries, visible state and action availability.
- Service-call assertions for exact transfer payloads, duplicate prevention and cancellation.
- Adapter validation of malformed responses, page/chain mismatches and HTTP errors.
- Infinite-list stale-response, cancellation, refresh, retry and deduplication checks.
- Native storage, credential, backup and journal tests, separately from JavaScript coverage.
- Existing CI checks: JavaScript coverage on Linux/Windows, active Android unit/build
  checks, Swift tests and simulator build, and Rust checks for active and retired cores.

Avoid a blanket folder reorganization, snapshot expansion or tests that merely
repeat implementation constants. Native rendering stubs do not verify animations,
biometrics, Keychain, gestures or real transaction execution.

## Proposed implementation order

1. **Isolation:** inject missing catalog services, add the functional network guard,
   and prove the two affected suites pass with both configured and absent API URLs.
2. **Active fixtures:** introduce a small stored-wallet factory and migrate the
   active Home/wallet journeys. Preserve cancellation, lock and account-switch assertions.
3. **Layout:** convert the render helper to named options, split `deferred`, and
   reclassify the mock transaction suite. Keep changes mechanical and check all imports.
4. **Assertions:** establish later-range/odd-row checks where supported, and keep
   device-only acceptance explicitly pending.

Run affected tests per step, then TypeScript, lint, formatting and the full coverage
suite once the batch is complete. Native implementations are unchanged by this
proposal; rerun native checks if shared native fixtures or module code change.

## Review baseline verification

- `npm run test:coverage`: **42 suites, 337 tests passed**; no snapshots.
- Global coverage: **89.97% statements, 86.80% branches, 90.30% functions,
  91.66% lines**; configured thresholds passed. Duration: 124.4 seconds, a single
  local run, not a performance benchmark or evidence of which tests are slow.
- Temporary network-guard diagnostic: **7 failed, 5 passed**; failures confirm
  unintended request attempts, not a newly introduced application regression.
- Native test files and CI wiring inspected; native suites, simulators, devices and
  live endpoints were **not run** for this review.
- No application/test implementation or package files changed by this review.

## Implementation results

- Injected offline catalog services in both affected wallet suites. Functional
  tests now block unexpected fetch calls and fail even if the UI catches the error.
  HTTP adapter tests retain their independent fetch mocks.
- Added fresh typed stored-wallet boundary/state factories and migrated active
  Home and app journeys to `createStoredWalletAccess`; backup and transfer fixtures
  reuse the same support. Real controllers, providers and session behavior remain.
- Changed `renderApp` to named options with an offline vault catalog default,
  migrated callers, and moved `deferred` into its own helper.
- Moved the mock transaction service tests into `unit/services/demoTransactions`
  and the retained legacy wallet debug tests into `functional/development`.
- Strengthened the large-grid check: after supplying simulated row measurements,
  it asserts item 500 becomes rendered, then reaches the final unpaired item 1000,
  keeping mounted-card counts bounded at both positions. Native gestures/layout
  acceptance remains separate.
- No app, native implementation or package changes were needed. Existing package
  edits and retained demo/native fixtures are preserved.

## Implementation verification

- TypeScript, lint, mobile formatting and diff checks passed.
- Full coverage run: **42 suites, 337 tests passed**, with all configured thresholds
  met. Test count is unchanged: assertions were strengthened and suites moved,
  rather than duplicating existing coverage.
- The four affected app/wallet suites passed all **25 tests** with an explicit API
  URL and the network guard enabled. The two previously leaking suites passed all
  **12 tests** with an empty API URL as well.
- The eight infinite-list tests passed, including later-range and final odd-card
  assertions under simulated layout.
- A temporary diagnostic deliberately caught a rejected fetch and still failed
  the guard's teardown assertion, proving handled errors cannot hide a request.
  The diagnostic was removed after this check; no request reached the network.
- Native suites, simulators, devices and live endpoints were not run. No native
  implementation or native fixtures changed. Physical scrolling acceptance remains
  pending; this test-maintenance batch is complete.
