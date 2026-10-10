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

- `VAULT_CHAINS`: comma-separated numeric chain IDs, for example `1,4663,143` for Ethereum, Robinhood and Monad. This takes precedence over legacy JSON chain selection. The phone combines these chains without showing a chain filter. Promotions must also belong to an enabled chain.
- `CATALOG_CHAINS_JSON`: chain metadata and optional display names. With `VAULT_CHAINS`, this extends/overrides built-in metadata; custom IDs require metadata here. Without `VAULT_CHAINS`, this selects enabled chains, defaulting to Robinhood (4663), Ethereum (1), and Monad (143) when omitted.
- `CATALOG_VAULTS_JSON`: additional featured/promoted vault contracts on enabled chains, such as Gizu Prime AUSD on Monad. This is additive; it never replaces regular discovery or the built-in Pendle USDC / Steakhouse USDG entries. Omitted or `[]` means no promotions. Matching chain/contract pairs merge into one card.
- `MORPHO_API_URL`: defaults/example endpoint is `https://api.morpho.org/graphql`.

Copy the JSON shape from [the environment example](../../backend/.env.example).
In Render, paste JSON **without surrounding shell quotes** and restart after changes.
Invalid addresses, duplicate entries or unknown chains prevent startup. With
`VAULT_CHAINS`, configured contracts on known inactive chains are retained in the
configuration but excluded from provider requests and results. Without it,
configured contracts must belong to an enabled JSON chain.
The regular investment catalog includes only the two vetted native deposit
profiles: Pendle USDC on Ethereum and Steakhouse USDG on Robinhood. Other ordinary
discovered contracts remain hidden, including legitimate USDC/USDG vaults without
native support. Explicit promotions are labeled **Featured** and can show other
assets, including AUSD. Featured vaults without native support have informational
details without deposit/withdraw buttons or a deposit amount calculator. Monad
currently has no native vault deposit route. Neither promotion configuration nor
provider metadata can add native execution support.

For the current Render rollout:

1. Deploy this branch's backend code; older deployments do not read `VAULT_CHAINS`.
2. Set `VAULT_CHAINS` to `1,4663,143` (no quotes) to include all three chains.
3. Keep `CATALOG_VAULTS_JSON` for Gizu Prime AUSD; copy its promotion example
   from the environment example if needed. It will coexist with the two regular
   profiles. Do not put the regular profiles here unless you want to feature them.
4. Verify `/v1/chains` lists Ethereum, Robinhood and Monad. Query
   `/v1/opportunities?chainId=1&page=0&items=20` and
   `/v1/opportunities?chainId=4663&page=0&items=20`; the supported profiles are
   Pendle USDC and Steakhouse USDG respectively. With the example promotion,
   `/v1/opportunities?chainId=143&page=0&items=20` returns Gizu Prime AUSD with
   `featured: true`. Provider outages can leave rates unavailable while configured
   entries remain visible using their fallback names.
5. Reopen or refresh Vaults on the phone after deployment.

Check `GET /v1/chains` after deployment. Native execution support must be implemented
and verified before adding another catalog profile. See [catalog internals](../internal/BACKEND_RUNTIME.md#catalog-validation-and-caching)
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
