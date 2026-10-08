# Backend deployment

Deploy the backend as a Render **Node Web Service**. All commands below run from
`backend/` unless stated otherwise.

## Render settings

| Setting        | Value                                                |
| -------------- | ---------------------------------------------------- |
| Root directory | `backend`                                            |
| Node version   | `NODE_VERSION=24.19.0` (previously verified version) |
| Build command  | `npm ci --include=dev && npm run build:render`       |
| Start command  | `npm start`                                          |
| Health check   | `/v1/health`                                         |
| Environment    | `NODE_ENV=production`; use Render's `PORT`           |
| Anvil path     | `EARN_ANVIL_PATH=.runtime/anvil-v1.8.3/anvil-fork`   |

`build:render` installs the pinned Anvil executable, then builds TypeScript. Earn
uses Anvil for isolated transaction simulations. Install it during the build,
not in a pre-deploy command. The installer supports Linux x86-64 only.
For local macOS development, use `npm run build` and configure a native Anvil
executable separately if testing Earn simulations.

## Environment variables

Use [backend/.env.example](../../backend/.env.example) as the configuration reference.
Set production values in Render; keep provider keys out of mobile/frontend bundles.

| Variables                               | Purpose                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`                          | Database connection.                                                                 |
| `MERKL_API_URL`, `MERKL_API_KEY`        | Vault catalog provider.                                                              |
| `ONEINCH_API_KEY`                       | Token quotes and Fusion gateway.                                                     |
| `AURORA_API_KEY`                        | Confidential quotes, balances and history.                                           |
| `PIMLICO_API_KEY`                       | Gas sponsorship and bundler gateway.                                                 |
| `ETHEREUM_RPC_URL`, `ROBINHOOD_RPC_URL` | HTTPS RPC providers with pinned-block state access for simulations.                  |
| `EARN_ANVIL_PATH`                       | Installed simulation wrapper.                                                        |
| `EARN_GATEWAY_RECOVERY_KEY`             | Durable recovery key: exactly 64 hexadecimal characters.                             |
| `EARN_AURORA_FEE_QUALIFICATION_JSON`    | Operator-verified, route-specific provider fee policy.                               |
| `EARN_AURORA_HISTORY_QUALIFIED`         | Set to `true` only after verifying authenticated, operation-specific history access. |

**Keep the recovery key unchanged across deployments** and maintain a protected
backup. Losing it prevents verification of existing payout recovery envelopes.

Fee and history qualification are prerequisites for executable funding/return
flows. Do not copy a sample fee policy or enable the history flag just to bypass a
failure. Follow the [qualification requirements](../internal/BACKEND_RUNTIME.md#recovery-and-provider-qualification).

## Vault catalog configuration

Optional catalog settings:

- `CATALOG_CHAINS_JSON`: enabled chain IDs and names. Without it, the catalog defaults to Monad.
- `CATALOG_VAULTS_JSON`: additional vault contracts on enabled chains. Omitted or empty means no custom vaults.
- `MORPHO_API_URL`: defaults/example endpoint is `https://api.morpho.org/graphql`.

Copy the JSON shape from [the environment example](../../backend/.env.example).
In Render, paste JSON **without surrounding shell quotes** and restart after changes.
Invalid addresses, duplicate entries or contracts on disabled chains prevent startup.

Check `GET /v1/chains` after deployment. Catalog listing does not enable native
investment execution for a contract. See [catalog internals](../internal/BACKEND_RUNTIME.md#catalog-validation-and-caching)
for validation, caching and partial results.

## Validate and deploy

1. Run `npm run typecheck`, `npm test` and `npm run build` locally.
2. Set the Render configuration above and deploy the intended commit.
3. Confirm build logs show successful Anvil installation and TypeScript compilation.
4. Check `/v1/health`, `/v1/chains` and the relevant catalog endpoints.
5. Verify provider access and simulation capacity before testing funded operations.

A healthy server does not prove that quotes, signing or settlement work.
The API allows up to two simulation forks per process; each has a 1 GiB memory
ceiling. Provision additional memory for Node and service overhead, and measure
actual resource use. Quote bindings are process-local, so consider this before
scaling to multiple instances.

For checksums, resource limits, recovery rules, deadlines and historical test
results, see [Backend runtime and provider requirements](../internal/BACKEND_RUNTIME.md).
For device and provider failures, see [Swap debugging](../internal/SWAP_DEBUGGING.md).
