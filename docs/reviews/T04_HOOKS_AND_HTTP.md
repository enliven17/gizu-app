# T04 + relevant T06 — Hooks, helpers and HTTP adapters

Reviewed 2026-09-29 at `9f38dff`, on `codex/mobile-review-plan`.
Status: review complete; implementation proposed below, not applied.

Scope: shared infinite pagination, token/vault catalog hooks, Home preview and
detail loading, TVL cache, catalog GET transport, wallet balance RPC transport,
chart geometry and vault display helpers. Native RPC/signing, backend implementation
and feature redesign are outside this slice.

## Findings

### 1. P2 — Successful TVL histories have application-lifetime freshness

Evidence: [useTvlSeries.ts](../../mobile/src/features/opportunities/useTvlSeries.ts),
lines 10–26 and 52–74; [AppRoot.tsx](../../mobile/src/application/AppRoot.tsx),
lines 39 and 74; [opportunities.ts](../../mobile/src/services/opportunities.ts),
the exported singleton service.

The cache is described as session-scoped but is keyed by a service instance. The
normal app reuses the same module-level service across sessions. Successful entries
have no expiration, size limit or invalidation. Catalog pull-to-refresh reloads
list data, but it does not refresh chart history. A refreshed TVL number can therefore
appear beside an old sparkline/change percentage. Empty successful histories also
remain cached. This concerns public market data, not cross-account wallet secrets.

A temporary mocked diagnostic loaded a history, unmounted its consumer, changed
the service's response, then remounted with an incremented attempt. The hook still
returned the original series and the service had been called only once. Failure
retry is intentionally different: failures are evicted and can retry already.

Proposed fix: keep in-flight deduplication and reuse on virtualization remounts,
but give the cache an explicit lifetime and freshness policy. Own it at the native
session/provider boundary, with bounded successful entries and a freshness timestamp.
Explicit catalog refresh should invalidate histories and notify mounted consumers;
deleting map entries alone is insufficient. Scope invalidation to the relevant cache
and reject stale in-flight completions after invalidation. No polling is needed.
Choose named TTL/size defaults during implementation and document their purpose.

### 2. P2 — Vault response validation does not enforce the selected protocol

Evidence: [opportunities.ts](../../mobile/src/services/opportunities.ts), lines 100–123.

The adapter selects a protocol-specific endpoint, but validates returned records
only with the general opportunity predicate. It verifies chain, page, page size
and duplicate IDs, but not the requested protocol. A temporary mocked diagnostic
requested `morpho`, returned a valid-shaped Aave record, and the adapter accepted it.
The UI could consequently show records inconsistent with its selected filter if
the backend or an intermediary returns the wrong catalog.

Proposed fix: validate each record against the requested protocol for filtered
queries; retain all protocols for `all`. Verify the API's protocol ID/slug convention
before implementing the comparison rather than matching display names. Add a
regression test using known contract identifiers. This is a mobile boundary gap;
no live backend mismatch was observed or claimed.

## Ownership and readability improvements

| Area                   | Observation                                                                                                                                                                    | Proposed change                                                                                                                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP transport         | `services/http.ts` and `services/wallet/balance.ts` duplicate caller-abort forwarding, a 12-second timer and cleanup.                                                          | Share a small JSON transport accepting request options. Keep GET catalog validation and POST JSON-RPC chain/balance checks in their adapters. Preserve existing error behavior; add no retry layer or dependency. |
| Home preview           | `useOpportunities` exposes search/page changes and debounces every request, but its only current caller, `VaultPreview`, reads `load` and `retry`.                             | Replace the obsolete pager-oriented API with a bounded preview loader. Load immediately; preserve cancellation and visible retry. Keep Home separate from infinite catalogs.                                      |
| Context ownership      | The service context is declared in the preview hook module and imported by detail, infinite catalog and history hooks.                                                         | Move the context/provider to a feature-level service-context file if adding cache ownership there. Avoid a generic context framework.                                                                             |
| Filter changes         | Token and vault `change()` functions invalidate even when selected values are unchanged. Tapping the selected radio clears results and requests the same query again.          | Compare effective query fields before invalidating; leave refresh as the explicit reload action. Cover repeated selection without losing loaded pages.                                                            |
| Detail identity        | `useOpportunityDetail` keys visible state by ID/revision, but not service instance. Replacing a service with the same ID can temporarily expose the previous service's result. | Include service identity in state, as `useTvlSeries` already does. Normal app service is currently stable, so this is robustness for injected/replaced services, not a demonstrated live-session defect.          |
| Pagination translation | Token and vault loaders both calculate the next numeric page.                                                                                                                  | Keep these short translations local for now. Extract only if their contract/policy grows; do not introduce an abstraction for one arithmetic expression.                                                          |

## Keep as-is

- `useInfiniteList` already serializes requests, aborts work, rejects stale results
  by generation, preserves cards on append/refresh errors, merges stable identities
  and detects stalled pagination. No rewrite is justified by this review.
- Catalog-specific validation belongs in service adapters, not the generic hook.
- Current token adapter checks requested chain/category, exact page shape and
  duplicate identities. Wallet balance checks its expected testnet and RPC result.
- Chart geometry stays with chart components; compact-money/date formatting stays
  with vault presentation. No catch-all `utils` directory is needed.
- `plotSeries` is not a general unbounded-series validator. Current consumers use
  bounded fixture/history data; speculative large-array optimization is not a priority.
- Keep Android-compatible compact currency formatting and existing unit cases.

## Proposed implementation order

1. **Correctness:** enforce the protocol response contract and add the mismatched
   response regression test.
2. **Transport:** consolidate timeout/caller cancellation plumbing. Test GET and
   POST options, already-aborted signals, cancellation during response-body reading,
   timeout, invalid JSON, HTTP errors and timer/listener cleanup. Keep RPC checks intact.
3. **Cache ownership:** add session scope, freshness/size limits and explicit refresh
   invalidation without losing remount deduplication. Test concurrent consumers,
   failure eviction, empty histories, refresh during an in-flight request, session
   replacement and mounted chart updates.
4. **Hook cleanup:** simplify Home preview, make unchanged filters no-ops, and bind
   detail state to service identity. Preserve search debounce and scroll behavior.

Run focused adapter/hook/screen tests per step, then TypeScript, lint, formatting
and full coverage. Native implementations and backend APIs need no changes for
this proposed batch. Device checks remain separate from mocked lifecycle checks.

## Verification

- Eight existing relevant suites passed: **92 tests** covering catalogs, details,
  infinite lists, token adapters, vault adapters and chart/domain helpers.
- Two additional temporary diagnostics passed, demonstrating the cache lifetime
  and accepted protocol mismatch described above. Both used controlled mocks and
  were removed after the review; they asserted current behavior, not desired fixes.
- Combined run: **9 suites / 94 tests passed**. This was a focused run, not another
  full coverage run. Wallet RPC validation was inspected, not rerun in this slice.
- No production implementation changed. No live endpoint, simulator or physical
  device checks were performed. These findings do not establish a native security issue.
