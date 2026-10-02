# Render backend runtime

The Earn deposit and exit planners need a server-local Anvil executable. The normal
`npm run build` remains a TypeScript build for local development. The dedicated
`npm run build:render` installs the pinned Linux executable before compiling the API.
This repository has no existing Docker deployment convention, so the prepared path
uses Render's native Node runtime. No live Render configuration is changed by these files.

## Service settings

Configure these settings when publishing the backend:

| Field            | Value                                                                      |
| ---------------- | -------------------------------------------------------------------------- |
| Runtime          | Node                                                                       |
| Root directory   | `backend`                                                                  |
| Node version     | `NODE_VERSION=24.19.0` (the verified local/container version)              |
| Build command    | `npm ci --include=dev && npm run build:render`                             |
| Start command    | `npm start`                                                                |
| Health check     | `/v1/health`                                                               |
| Environment      | `NODE_ENV=production`, Render-provided `PORT`, and the server fields below |
| Anvil executable | `EARN_ANVIL_PATH=.runtime/anvil-v1.8.3/anvil-fork`                         |

The relative Anvil path resolves from the configured `backend` root directory.
An absolute equivalent is `/opt/render/project/src/backend/.runtime/anvil-v1.8.3/anvil-fork`.
Install during the build, not a pre-deploy command: Render documents that pre-deploy
filesystem changes do not reach the running service. Build output contains the executable;
no runtime download, Rust toolchain or persistent disk is needed for forks.

The installer currently supports **Linux x86-64 only**. An unsupported platform,
failed download, checksum disagreement, incompatible executable or missing wrapper
stops the build. There is no fallback to a floating Foundry release or fabricated gas.
Local macOS development can configure a separately verified native Anvil through
`EARN_ANVIL_PATH`; `npm run runtime:anvil` intentionally rejects macOS.

## Verified release

The installer pins [Foundry v1.8.3](https://github.com/foundry-rs/foundry/releases/tag/v1.8.3),
commit `cae51ad458f6abb64852b7709eb784352429825d`, and this exact archive:

```text
https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz
SHA-256: 7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568
```

The digest was independently read from the official release API and its
[published checksum file](https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.sha256),
then checked against the downloaded archive. The extracted `anvil` digest is
`674a06c97a01350cd00241762bbfb01ebcafce9b6e8cbd6c8758ecea6ef4b968`; this is derived
from the verified archive and is checked before executing a cached binary.
The installer extracts only `anvil`, bounds the download to 128 MiB and five minutes,
checks the exact executable version/commit, and copies the maintained fork wrapper.
An offline archive can be supplied with
`npm run runtime:anvil -- --archive /path/to/foundry_v1.8.3_linux_amd64.tar.gz`;
the same digest checks apply.

Checksum pinning checks integrity. Foundry also publishes release attestations;
operators who require provenance verification can use the official
[Foundry verification instructions](https://github.com/foundry-rs/foundry/security)
and `gh attestation verify` with `--repo foundry-rs/foundry` and the fixed release
workflow identity. Updating the pin requires a reviewed artifact/checksum change
and repeating the Linux checks; do not substitute `foundryup` or `latest` in the build.

## Server configuration

Credentials and configuration stay in Render's server environment. Never put them
in `EXPO_PUBLIC_*`, mobile bundles or research configuration files.

| Field                                | Purpose                                                                       |
| ------------------------------------ | ----------------------------------------------------------------------------- |
| `DATABASE_URL`                       | Existing server database connection                                           |
| `MERKL_API_URL`, `MERKL_API_KEY`     | Existing catalog provider configuration                                       |
| `ONEINCH_API_KEY`                    | Server-held 1inch quotes and constrained native Fusion gateway                |
| `AURORA_API_KEY`                     | Authenticated confidential history/balances and provider quotes               |
| `PIMLICO_API_KEY`                    | Server-held fixed-chain token sponsorship and native bundler gateway          |
| `ETHEREUM_RPC_URL`                   | HTTPS Ethereum read/fork provider with recent pinned-block state access       |
| `ROBINHOOD_RPC_URL`                  | HTTPS Robinhood chain 4663 read/fork provider with pinned-block state access  |
| `EARN_ANVIL_PATH`                    | The installed resource-limited `anvil-fork` wrapper above                     |
| `EARN_AURORA_FEE_QUALIFICATION_JSON` | Versioned route-specific provider fee qualification                   |
| `EARN_GATEWAY_RECOVERY_KEY`          | Durable server-only 32-byte AES-256 key, encoded as exactly 64 hex characters |

Retain the recovery key across deploys and restarts. Changing or losing it prevents
verification of existing native-protected payout recovery envelopes. Keep a protected
operator backup; never print it or generate a new key automatically during startup.
Recovery envelopes carry the original immutable unsigned quote/intent context;
native storage retains the nonce/role guard and exact signed bytes for reconciliation.

Use a versioned, operator-qualified registry with independent rules for `source`,
`payoutEthereum`, `payoutRobinhood`, `returnUsdc`, `returnEth`, `returnRobinhood` and `withdrawal`.
Each route lists the approved provider collectors, maximum basis points per collector,
maximum total basis points, exact referral (or null), zero integrator fee, zero Gizu
application charge, and a reference to the operator's qualification evidence. The
following illustrates the schema; **it does not qualify a collector or API key**:

```json
{
  "version": "verified-policy-2026-10-01",
  "routes": {
    "source": {
      "collectors": [{ "recipient": "verified-provider.near", "maximumBps": 4 }],
      "maximumTotalBps": 4,
      "referral": null,
      "integratorFeeBps": 0,
      "applicationFeeAtoms": "0",
      "qualificationReference": "operator-key-configuration-record"
    }
  }
}
```

Before configuring this variable, obtain the key's public and confidential fee rules,
collector ownership/beneficiaries and referral commission terms from Aurora. Record
why each charge is an established provider fee and why Gizu receives no integrator or
application commission. A dry quote, an existing research key or a collector name is
insufficient evidence. The `appFees` API field does not itself classify the beneficiary.
Source funding requires rules for every payout/return route in the selected profile, including the separate `withdrawal` route to a newly allocated public Monad USDC recipient.
Unknown collectors/referrals, duplicate collectors, changed routing and excessive fees
remain rejected. Basis point totals describe listed quote fees, not all route costs.
The executable minimum output and each separate gas/reserve review remain authoritative.

The legacy exact-2-bps/no-referral JSON remains supported for existing qualified setups.
It is not the global fee requirement. The policy version and **actual** executable fee
breakdown are bound into quote identity/recovery and the native review; changes need
new unsigned terms and user approval. Saved signed payloads remain immutable.

Set `EARN_AURORA_HISTORY_QUALIFIED=true` only after verifying this key has authenticated,
operation-scoped `account/history` access and validating its evidence against canonical
receipts, actual amounts and concurrent activity. Default/missing/false blocks new
funding and returns before signing. It is an operator qualification, not a bypass for
invite-only history. Reconciliation still checks the live authenticated evidence and
never substitutes balances or public SUCCESS. Dry source previews remain unsigned,
uncached and unusable as quote bindings, and show the blockers on the existing screen.

## Vault catalog configuration

Set these server variables in `.env` locally and in Render's environment when deploying:

```dotenv
CATALOG_CHAINS_JSON='[{"id":4663,"name":"Robinhood"},{"id":1,"name":"Ethereum"},{"id":143,"name":"Monad"}]'
CATALOG_VAULTS_JSON='[{"chainId":143,"address":"0x997D5064A7B48305c15C9D55AC2D94D7069Fc008","name":"Gizu Prime AUSD","symbol":"gzpAUSD","asset":{"address":"0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a","name":"AUSD","symbol":"AUSD","decimals":6}}]'
MORPHO_API_URL=https://api.morpho.org/graphql
```

In Render, enter the JSON value without the surrounding shell quotes. Restart the
backend after changing configuration. `GET /v1/chains` returns `{ "list": [...] }`;
the existing opportunities endpoints filter Merkl by the requested enabled chain
and retain the Aave/Morpho/Curvance protocol filters. Mobile combines the enabled
chains into one catalog and Home preview, without a chain picker.
Without `CATALOG_CHAINS_JSON`,
the legacy Monad-only catalog remains enabled. The example and local configuration
include the operator-selected Gizu Prime AUSD vault on Monad. The same array accepts
Ethereum (1), Robinhood (4663), and any other chain enabled in `CATALOG_CHAINS_JSON`.
An omitted or empty `CATALOG_VAULTS_JSON` adds no custom contracts.

Each entry has its own chain ID. For example, the configured Monad vault is:

```json
[
  {
    "chainId": 143,
    "address": "0x997D5064A7B48305c15C9D55AC2D94D7069Fc008",
    "name": "Gizu Prime AUSD",
    "symbol": "gzpAUSD",
    "description": "Gizu Prime AUSD vault on Morpho, Monad mainnet.",
    "depositUrl": "https://app.morpho.org/monad/vault/0x997D5064A7B48305c15C9D55AC2D94D7069Fc008/gizu-prime-ausd#overview",
    "tags": ["lending"]
  }
]
```

Contract addresses must be real nonzero 20-byte EVM addresses.
Optional `asset` metadata takes `{ "address": "0x…", "name": "USD Coin",
"symbol": "USDC", "decimals": 6 }`, using that chain's actual underlying token.
Duplicate chain IDs, duplicate chain/contract pairs, malformed JSON, invalid
addresses and contracts on disabled chains stop startup with a field-specific error.

Only configured contracts are looked up through Morpho's public
[GraphQL API](https://docs.morpho.org/developers/earn/tutorials/get-data/).
V1 and V2 are queried separately: a missing non-nullable version otherwise nulls
the entire GraphQL result. Available API metadata wins; environment values fill
missing name/symbol/description/asset fields. Without either source, the name uses
the chain and shortened contract address. Missing yield, TVL and prices are `null`
and displayed as unavailable. Morpho net APY is explicitly labeled APY using
`rateType: "apy"`; it is not presented as Merkl APR. History is empty for custom
entries because this integration has no historical Morpho series.

Configured rows have stable `configured:<chainId>:<lowercase address>` IDs,
`vaultAddress` and share `symbol` in list/detail responses. Matching Merkl contract entries are merged
once across pages. Chains without extra contracts retain Merkl's existing paging.
For chains with extras, a shared five-minute snapshot loads at most ten 100-item
Merkl pages under one shared eight-second provider deadline, then applies
protocol/search/paging locally. Morpho lookups are also
cached/coalesced for five minutes. A Merkl failure or a catalog exceeding that bound
sets `partial: true`; the mobile screen explicitly marks the available subset.
Persistent response caches are namespaced by configuration so removed chains or
contracts cannot reappear from an earlier configuration's cache.

Catalog configuration is read-only. It does not change the funded source network,
native signing policies or the pinned Confidential Earn execution registry. Listing
a contract does not enable investing into it through the native Earn flow.

## Fork isolation and capacity

Anvil binds only to `127.0.0.1` on an allocated free port, with zero generated
accounts and no storage cache. The wrapper limits each child to 1 GiB virtual memory,
60 CPU seconds, one Rayon worker, two Tokio workers and no core dumps. The API
allows at most two concurrent forks per Node process, fails fast at capacity, and
bounds fork wall time to 30 seconds by default (constructor maximum 60 seconds).
Every reference header/chain/hash is verified before simulation. Normal completion,
error and timeout send SIGTERM, then SIGKILL if necessary; child output is discarded
and child environment contains only PATH plus the wrapper's worker settings.

Provision the service with memory above the combined two-fork ceilings plus Node
and service overhead; the wrapper is a per-child ceiling, not a total service limit.
Check actual latency, peak memory and provider rate limits on the selected service
before enabling traffic. `--compute-units-per-second 1000` is Anvil's upstream RPC
rate setting, not an OS CPU limit; the wrapper supplies the CPU limit separately.
Scale instances only with awareness that limits and unsigned quote registries are
process-local. An unknown or expired quote binding fails closed; payout recovery
uses its protected immutable envelope, not an invented surviving cache entry.

Fork funding and impersonation affect disposable loopback state only. The API never
fabricates a live destination balance. A deposit stays invested; any redemption
during deposit planning is isolated simulation solely to estimate a reserve.
Live withdrawal, return and final native sponsorship each require a separate fresh
review. Provider credentials, successful quote admission and a deployed binary do
not themselves authorize a transaction.

## Verification and limits

Run `npm run typecheck`, `npm test` and `npm run build` from `backend`.
The runtime tests reject unsupported platforms, corrupted archives and symlink caches.
The verified Linux Anvil version/commit, offline archive installer, cached installer
and complete `npm run build:render` were exercised successfully in a disposable
`node:24.19.0-bookworm` Linux x86-64 container. The resource-limited wrapper also
started an isolated fork of a second loopback-only Anvil, and read-only RPC verified
that the fork retained the exact pinned upstream block hash. Networking was disabled;
no transactions, research secrets or server credentials were used. This verifies the
prepared build and bounded executable path on Debian 12, matching Render's documented
native operating system; it does not verify live chain simulation or a fresh network
`npm ci` against a Render service.
The current machine is macOS ARM64; no live Render build, service setting or publish
was exercised by this preparation. Real provider credential/fee qualification remains
an operator prerequisite, and rendered mobile tests do not prove phone authorization.

Optional read-only upstream/fork tests use `EARN_TEST_ANVIL_PATH` with
`EARN_TEST_ETHEREUM_RPC_URL` or `EARN_TEST_ROBINHOOD_RPC_URL`. Their known public test
wallets are funded only inside disposable local forks, never on the origin chain.

References: [Render native runtimes](https://render.com/docs/native-runtimes),
[build/pre-deploy/start behavior](https://render.com/docs/deploys),
[Node version selection](https://render.com/docs/node-version).

## Exit valuation freshness

Exit snapshots read only the investment wallet, including vault shares and wrapped
ETH. Current chain balances and refreshed native return receipt/credit reconciliation
retain their one-minute freshness boundary. Valuation prices allow at most five
minutes, matching the USDG return policy, with at most five seconds of future skew.
The response preserves each provider `priceUpdatedAt` value and declares
`priceMaxAgeMs: 300000`; it never replaces an older price timestamp with the fetch time.
Snapshot expiry is the earliest of the chain reference plus one minute, oldest
required price plus five minutes, and observation time plus one minute.

The [official token schema](https://docs.intents.aurora.dev/api-reference/swap-api-reference/get-supported-tokens.md)
describes numeric USD prices, string update timestamps and optional token contracts.
A read-only credential-free request to `https://intents-api.aurora.dev/api/tokens/`
on 2026-09-30 verified the Ethereum USDC, Monad USDC, Robinhood USDG and native
Ethereum ETH metadata. Native ETH omits `contractAddress`; the three ERC-20
contracts and all decimals matched the pinned registry. Production uses the
configured server key; credential-free listing does not qualify key settings or fees.

Public samples, including cache-bypassing requests, had price ages of approximately
65–107 seconds. The documentation publishes no guaranteed price update cadence.
The five-minute limit is an application validity bound, not a provider freshness SLA;
older or inconsistent prices still prevent a completion result.

## Generated unsigned payout deadlines

The provider may generate an ERC-191 transfer message with a multi-day deadline
even when the approved quote expires within ten minutes. Fresh payout preparation
first rejects duplicate/unknown fields and verifies the signer, private token, exact
amount, deposit receiver and canonical 32-byte nonce. It then narrows only the unsigned
message deadline to the earlier of its original deadline and the verified quote,
request and inactivity expiry. It does this before computing payload/quote hashes or
creating the recovery envelope and native journal context. Already-bounded payload
bytes are retained exactly. Signed submissions, recovered records and retries never
call the narrowing helper; they continue to require the exact approved signed bytes.

The [official Aurora ERC-191 signer](https://github.com/aurora-is-near/intents-swap-widget/blob/357e9447aaa774f1f89c6d5684065c4b11012977/packages/intents-connect/src/signers/standards/erc191.ts)
signs the caller's message verbatim. The [primary NEAR Intents engine](https://github.com/near/intents/blob/a80379014db185e4a2d2d2b45beffe0f96cae31d/contracts/defuse/core/src/engine/mod.rs)
checks the deadline extracted from that signed payload and rejects an expired
message; a versioned nonce requires the signed deadline to be no later than the
nonce's own deadline. Narrowing fresh unsigned authority preserves that bound.
No documented generator deadline parameter was found, and the API does not invent
one. Native deadline limits, protected nonce uniqueness and normal 2-basis-point
provider fee qualification remain required.

## Authenticated history access

The configured Aurora key must have authenticated `account/history` access for source credit, independent payouts and returns. A live read on 2026-09-30 rejected the research key with an invite-only history error even though balance authentication, quote preparation and a separately authorized research funding transfer worked. Obtain this provider entitlement before a funded phone test. Public status and aggregate balances cannot replace operation-specific settlement evidence. This requirement is separate from the existing fee collector/referral qualification and Render environment configuration.
