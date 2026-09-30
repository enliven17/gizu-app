# Gizu

Each application lives in its own top-level folder:

- `frontend/`: React, TypeScript, and Vite web app.
- `mobile/`: Expo / React Native mobile app. See [mobile setup](mobile/README.md).
- `backend/`: TypeScript API server with automated tests.
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

GitHub Actions checks pull requests and pushes to `main`:

| Workflow | Applications            | Checks                                                                           |
| -------- | ----------------------- | -------------------------------------------------------------------------------- |
| Mobile   | `mobile/`               | JavaScript checks, Rust core tests, Android build and iOS simulator checks       |
| Backend  | `backend/`              | Locked dependency install, source/test type checks, tests and server compilation |
| Web      | `frontend/`, `landing/` | Independent locked installs, TypeScript checks and Vite production builds        |

Backend and Web can also be run manually from the Actions tab. They use Node
24.15.0, matching mobile CI, and each app's own npm lockfile. They need no deployment
credentials or production API keys. Backend tests use test doubles and deliberate
failure cases; they do not validate a live database or provider integration.
Frontend and landing do not currently have automated test or lint scripts, so their
CI coverage is limited to type checking and building.

Jobs have timeouts, and newer runs cancel superseded runs on the same ref. Both
web apps finish independently when one fails. Backend test logs and successful web
`dist` builds are downloadable from the workflow run for seven days. Artifacts are
for inspection; these workflows do not deploy or publish an app. Research
prototypes are excluded from application CI.

Reproduce checks locally:

```sh
npm --prefix backend ci
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run build
npm --prefix frontend ci
npm --prefix frontend run build
npm --prefix landing ci
npm --prefix landing run build
```

All workflows run without path filters so required checks do not stay pending on
unrelated pull requests. To enforce them before merging, configure the relevant
job checks as required in GitHub branch protection or repository rulesets.
