# Mobile foundation

Current source baseline checked 2026-09-24. This reference describes the runtime;
remaining work belongs in [the roadmap](../feature-plans/MOBILE_ROADMAP.md). Historical milestone diaries
remain in Git. Native evidence is summarized in
[signer verification](NATIVE_SIGNER_VERIFICATION.md).

## Runtime and ownership

- Expo 57.0.24, React Native 0.86.3, React 19.2.3; New Architecture and Hermes.
- NativeWind 4.2.7 / Tailwind 3.4.17, React Navigation 7 (no Expo Router),
  Reanimated 4.5.1 / Worklets 0.10.1, SVG, safe areas and native screens.
- npm-local lockfile; Node 24 / npm 11 constraints are declared in package.json.
- Strict TypeScript, ESLint, Prettier, Jest/jest-expo/RNTL and coverage thresholds.
- Exact dependencies and scripts: `package.json` / `package-lock.json`. Do not
  duplicate full version tables here or bypass peer conflicts with force flags.
- Features own screens/controllers; shared atomic UI, domain rules, service adapters,
  application composition and navigation have separate owners. Native integration
  lives in `modules/`; generated bindings are regenerated, never hand-edited.

## Platforms and presentation

Expo baseline is distinct from passkey capability: native signer requires iOS 18+
and Android API 28+ with a PRF-capable provider. OS eligibility alone does not
establish provider compatibility. Check installed build configuration before
changing platform floors. Local iOS builds require macOS/Xcode; Windows validation
and root just recipes remain deferred.

System fonts remain the fallback until frontend font redistribution rights are
confirmed. Use shared semantic tokens, safe areas, accessible controls, text scaling
and reduced motion. Portrait-first/no dedicated tablet layout remains provisional.
Current product behavior is owned by [PARITY](../feature-plans/PARITY.md), not historical phases.

## Identity and release boundary

Development identity and domain association setup live in
[passkey configuration](../app-guide/PASSKEY_CONFIGURATION.md) and
[Android signing](../app-guide/ANDROID_SIGNING.md). Do not treat development placeholders,
shared RP or a successful local probe as production release approval.
Production identity/EAS ownership, signing, physical device acceptance, independent
recovery and security review remain open. Never silently connect fixture investments
to a real native signer.

## Recorded verification limits

Mobile functional checks validate rendered behavior with external services mocked.
They do not prove native biometrics, signing isolation or network settlement.
The historical Expo Doctor patch mismatch (57.0.24 / 57.0.25) awaits fresh checking.
UI milestone tests/builds were recorded during development; small-display,
accessibility, Windows and full signed-device acceptance were incomplete.
See the signer verification record for exact retained native/live evidence and
README for commands. No checks were rerun by this documentation consolidation.
