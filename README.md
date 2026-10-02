# Gizu

Each application lives in its own top-level folder:

- `frontend/`: React, TypeScript, and Vite web app.
- `mobile/`: Expo / React Native mobile app. See [mobile setup](mobile/README.md).
- `backend/`: Fastify API for catalog, token discovery, Swap and Earn preparation and settlement. See [Earn integration/deployment](mobile/docs/CONFIDENTIAL_EARN.md).
- `landing/`: React, TypeScript, and Vite landing website.

## Run the frontend

```bash
cd frontend
npm ci
npm run dev
```

Open the local URL printed by Vite (normally http://localhost:5173).
The current frontend uses mock data and simulated authentication; no backend
or environment variables are required.

To build and preview the frontend:

```bash
npm run build
npm run preview
```

## Continuous integration

Pull requests and pushes to `main` run the fast checks:

| Workflow | Checks                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------- |
| Mobile   | Linux only: locked install, typecheck, formatting, lint, build-script tests and all JavaScript tests |
| Backend  | Locked install, source/test type checks, tests and compilation                                       |
| Web      | Independent TypeScript checks and Vite builds for frontend and landing                               |

PRs do not run Android/iOS builds, Rust compilation, Windows mobile checks, Expo
Doctor or coverage collection. Native-only regressions can therefore pass PR
checks; run release validation manually before merging native/signing changes.
JavaScript tests still run in full. Frontend and landing currently have no separate
test or lint scripts.

**Release validation** runs when a `v*` tag is pushed, or manually from
Actions → Release validation → Run workflow (choose the branch or tag). It runs:

- The full mobile checks on Linux and Windows, including Expo Doctor and coverage thresholds.
- Rust formatting, tests and Clippy for both signer cores.
- Android formatting, native tests and APK compilation.
- iOS signer tests in Debug and Release, followed by the Release simulator app build.
- The same backend and web validation through reusable workflows.

Manual runs validate the selected revision; tag runs validate that tagged revision.
This validates a release candidate; it does not publish a GitHub release, deploy a
service or upload a signed app to a store. Wait for all release checks to pass
before distributing that revision. No production credentials are needed. Backend
tests use test doubles; live database/provider integration is not covered.

All jobs use timeouts and app-local lockfiles with Node 24.15.0. PR workflows cancel
superseded runs. Release validation does not cancel an active validation of the same
ref. Logs, coverage and available native failure reports are retained for seven
days; web build artifacts are available for inspection. Research prototypes are
excluded.

Local commands remain unchanged:

```sh
npm --prefix mobile ci
npm --prefix mobile run typecheck
npm --prefix mobile run format:check
npm --prefix mobile run lint
npm --prefix mobile test
# Full mobile checks, including Doctor and coverage:
npm --prefix mobile run check
npm --prefix backend ci
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix landing ci
npm --prefix landing run build
```

Workflows have no PR path filters, so required checks do not stay pending on
unrelated changes. In branch protection/rulesets, require **Mobile PR checks**,
**Backend checks**, **Build frontend** and **Build landing**. Remove old mobile
matrix/native jobs from PR-required checks; those now belong to release validation.
Repository settings are not changed by these workflow files.
