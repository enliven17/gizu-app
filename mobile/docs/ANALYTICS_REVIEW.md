# Mobile analytics review and improvement plan

Reviewed 2026-09-30: `feat/mobile-posthog` at `7dc6465`, against
`origin/main`. Scope is the six branch-changed files and their navigation,
configuration and SDK dependencies. Findings below describe the reviewed snapshot.

## Implementation status

All code and documentation suggestions are implemented locally:

- Lifecycle capture is off; an outbound filter drops non-screen events. Replay,
  automatic exceptions, surveys and feature-flag preloading are explicitly off.
- The SDK is lazy and private behind an injectable `AnalyticsService`. Missing or
  invalid configuration does not instantiate it; failures stay inside telemetry.
- The unused provider is removed. Focused route keys deduplicate state changes,
  and container readiness resets tracking on session replacement.
- Tests cover configuration, URL-bearing lifecycle events, failures, navigation,
  parameter changes, detail instances, session replacement and test isolation.
- README and environment examples describe metadata and environment separation.

Verification: typecheck, lint and formatting passed. All 371 tests in 49 suites
passed with coverage thresholds satisfied (87.19% statements, 83.12% branches).
The new screen-tracking hook has 100% coverage; the analytics adapter has 100%
statement coverage and 95.23% branch coverage.

Native verification:

- Android `:app:assembleDebug` passed, including the added Expo modules.
- iOS unsigned arm64 Release simulator build passed after `pod install`.
- iOS Debug simulator linking failed with missing React Native symbols including
  `RCTPackagerConnection`, `RCTReconnectingWebSocket` and `Sealable`. The cause
  has not been isolated; Debug readiness is not claimed. No unrelated native
  source changes were made to work around it.
- Restored Skia's packaged native binaries using its existing install script
  after the earlier dependency install had skipped lifecycle scripts.

Live event inspection in a dedicated PostHog test project remains a manual check;
no live events were intentionally sent during implementation.

## Findings

### 1. P1: automatic lifecycle capture sends the launch URL

**Evidence:** `src/services/analytics.ts:12` enables lifecycle capture. In the
installed `posthog-react-native` 4.78.2 source map, `captureAppLifecycleEvents()`
reads `Linking.getInitialURL()` and adds its complete value as `url` to
`Application Opened`. Supplying an existing client means the provider's
`autocapture={false}` does not override this client option.

**Impact:** opening a deep link containing an identifier or sensitive query value
can transmit that value to PostHog. This bypasses the deliberate route-name-only
restriction in `AppRoot.tsx:66–69`, even if navigation rejects the destination.
This is a confirmed SDK path, not evidence that sensitive data has already been
sent from a device. Confidence: high.

**Fix:** disable automatic lifecycle events initially. Keep screen tracking. If
lifecycle metrics are needed, add explicitly selected events with safe properties,
or a tested outbound sanitizer covering all SDK-generated events. Do not forward
raw URLs, navigation parameters, wallet identifiers, amounts or transaction hashes.

### 2. P2: state changes can overcount screen views

**Evidence:** `src/application/AppRoot.tsx:67–69,81–82` records the current route
on every navigation-state notification without checking whether the visible route
changed. React Navigation's state callback is broader than screen transitions.

**Impact:** parameter-only or nested-state updates that leave the same visible
screen can add duplicate screen events. Normal tab changes should still count,
as should returning to a screen after visiting another one. This is a static
edge-case finding; no duplicate production events were inspected. Confidence: high.

**Fix:** retain the previous focused route identity in a ref and emit only when
it changes. Compare route keys, not just names, so distinct detail instances can
count while repeated state notifications do not. Never send route keys. Reset
the tracker when the session-keyed navigation container is recreated and record
its initial screen once.

### 3. P2: the enabled analytics path has no focused test coverage

**Evidence:** the branch adds no tests; no PostHog/analytics assertions or mock
boundary exist under `tests/`. The client is a module-level singleton and reads
the developer's environment at import time.

**Impact:** existing journeys can pass with capture disabled without protecting
event contents or counts. If the public key is supplied to a test process, the
real SDK may initialize capture/network behavior instead of a test substitute.
Confidence: high for the coverage gap; no live test traffic was observed.

**Fix:** inject a small screen-tracking service into app composition. Use a fake
for navigation tests and mock the SDK at the adapter boundary. Explicitly keep
ordinary tests independent of the developer's analytics environment.

## Small maintainability improvements

- Expose a narrow `trackScreen` interface instead of the full SDK singleton. Keep
  vendor configuration and error handling in `services/analytics.ts`; avoid a new
  generic telemetry framework. Handle synchronous and rejected-promise failures
  without interrupting navigation or logging sensitive context.
- Remove `PostHogProvider` if manual screen tracking remains its only consumer.
  No current code uses its context or touch autocapture; official documentation
  makes this provider optional for manual tracking. Retain it only for a concrete
  requirement. This is cleanup, not a confirmed rendering defect.
- Normalize public-key/host configuration, document which build environments send
  events, and keep missing configuration disabled. Do not assume a missing key in
  `eas.json` proves it is missing from EAS-managed environments.
- Document default device/app metadata and anonymous installation identifiers.
  `personProfiles: "identified_only"` does not mean events have no identifier or
  metadata. Decide development/test/release separation before using metrics.
- Preserve safe defaults already present: no wallet-based identification, no route
  parameters in manual screen events, and touch autocapture disabled. Do not add
  financial events, replay, consent UI or account-linked identities in this cleanup.

## Proposed implementation order

1. **Close the URL leak.** Disable automatic lifecycle capture and add regression
   coverage using a launch URL containing synthetic sensitive data. Assert that
   no raw URL or query values reach the analytics boundary.
2. **Simplify the integration and fix screen counting.** Add the narrow injectable
   adapter, remove the unused provider, contain analytics failures, and deduplicate
   focused-route notifications. Keep app/session/navigation ownership unchanged.
3. **Complete tests and setup documentation.** Cover missing/invalid configuration,
   safe enabled configuration, initial screen, tab changes, back navigation,
   parameter-only updates, separate detail instances, session replacement, SDK
   failure, and isolation from environment-provided keys. Document local and EAS
   configuration in the existing README and environment example.

## Acceptance and verification

- No secrets, raw URLs, route params or financial identifiers in emitted events.
- One screen event per focused-route transition; one initial event per container.
- Analytics failures do not block startup, sign-in, navigation or wallet actions.
- Missing configuration remains usable and ordinary tests make no analytics calls.
- Run mobile typecheck, lint, formatting and the full JavaScript suite after fixes;
  run coverage once for release validation. Rebuild native apps to verify the new
  Expo native dependencies, then inspect event payloads in a dedicated test project.
- No production dashboard changes or external publishing are part of this plan.

This review used static app/SDK inspection and current SDK documentation. The
preceding merge verification on the same commit passed typecheck, lint, dependency
file formatting and 349 tests across 46 suites. Those results are not analytics
acceptance. No enabled analytics device/network test was run. Native rebuild outcomes from
implementation are recorded above.

Reference: [PostHog React Native documentation](https://posthog.com/docs/libraries/react-native).
