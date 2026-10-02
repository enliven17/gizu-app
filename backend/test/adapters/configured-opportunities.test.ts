import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfiguredOpportunities } from "../../src/adapters/catalog/configured-opportunities.ts";
import type {
  Opportunities,
  Opportunity,
} from "../../src/ports/opportunities.port.ts";

const address = "0x1111111111111111111111111111111111111111";
const chains = [
  { id: 143, name: "Monad" },
  { id: 1, name: "Ethereum" },
];
const query = {
  protocol: "all" as const,
  search: "",
  page: 0,
  items: 1,
  chainId: 143,
};
const row: Opportunity = {
  id: "merkl",
  name: "Existing",
  chainId: 143,
  chain: chains[0]!,
  protocol: { id: "morpho", name: "Morpho" },
  status: "LIVE",
  apr: 1,
  totalApr: 1,
  tvl: 10,
  vaultAddress: address,
};
function provider(rows = [row]): Opportunities {
  return {
    list: async (q) => ({
      list: rows.slice(q.page * q.items, (q.page + 1) * q.items),
      total: rows.length,
    }),
    getById: async () => {
      throw new Error("unused");
    },
    tvlRecords: async () => [],
  };
}

test("unconfigured chains preserve Merkl pagination and disabled chains never call it", async () => {
  let calls = 0;
  const merkl = provider();
  const catalog = new ConfiguredOpportunities(
    chains,
    [],
    {
      ...merkl,
      list: async (q) => {
        calls++;
        return merkl.list(q);
      },
    },
    { lookup: async () => null },
  );
  assert.deepEqual(await catalog.list(query), { list: [row], total: 1 });
  await assert.rejects(
    catalog.list({ ...query, chainId: 10143 }),
    /not enabled/,
  );
  assert.equal(calls, 1);
});

test("configured contracts merge once across pages, search and protocol filters", async () => {
  const other = {
    ...row,
    id: "other",
    vaultAddress: "0x2222222222222222222222222222222222222222",
  };
  let lookups = 0;
  const catalog = new ConfiguredOpportunities(
    chains,
    [{ chainId: 143, address, name: "Manual vault" }],
    provider([row, other]),
    {
      lookup: async () => {
        lookups++;
        return null;
      },
    },
  );
  const first = await catalog.list(query);
  const second = await catalog.list({ ...query, page: 1 });
  assert.equal(first.total, 2);
  assert.equal(first.list[0]!.name, "Manual vault");
  assert.equal(first.list[0]!.totalApr, null);
  assert.equal(first.list[0]!.vaultAddress, address);
  assert.equal(second.list[0]!.id, "other");
  assert.equal(lookups, 1);
  assert.equal((await catalog.list({ ...query, search: "manual" })).total, 1);
  assert.equal((await catalog.list({ ...query, protocol: "aave" })).total, 0);
  const detail = await catalog.getById(first.list[0]!.id);
  assert.equal(detail.explorerAddress, address);
  assert.equal(detail.tokens.length, 0);
  assert.deepEqual(await catalog.tvlRecords({ id: detail.id, items: 30 }), []);
  await assert.rejects(
    catalog.getById(
      `configured:143:0x3333333333333333333333333333333333333333`,
    ),
  );
});

test("Morpho metadata wins, env fills missing fields, unavailable providers are explicit", async () => {
  const merkl = {
    ...provider(),
    list: async () => {
      throw new Error("maintenance");
    },
  };
  const catalog = new ConfiguredOpportunities(
    chains,
    [{ chainId: 143, address, name: "Fallback", description: "From env" }],
    merkl,
    {
      lookup: async () => ({
        name: "API name",
        netApy: 0.05,
        totalAssetsUsd: 100,
      }),
    },
  );
  const page = await catalog.list(query);
  assert.equal(page.partial, true);
  const detail = await catalog.getById(page.list[0]!.id);
  assert.equal(detail.name, "API name");
  assert.equal(detail.description, "From env");
  assert.equal(detail.totalApr, 5);
  assert.equal(detail.rateType, "apy");
  assert.equal(detail.nativeApr, null);
});

test("configured snapshots are shared, bounded and preserve available pages after a failure", async () => {
  const calls: number[] = [];
  const merkl = {
    ...provider(),
    list: async (q: typeof query & { signal?: AbortSignal }) => {
      calls.push(q.page);
      assert.ok(q.signal instanceof AbortSignal);
      if (q.page === 1) throw new Error("failed page");
      return {
        list: [
          {
            ...row,
            id: `page-${q.page}`,
            vaultAddress: `0x${String(q.page + 2).repeat(40)}`,
          },
        ],
        total: 2000,
      };
    },
  };
  const catalog = new ConfiguredOpportunities(
    chains,
    [{ chainId: 143, address, name: "Configured" }],
    merkl,
    { lookup: async () => null },
  );
  const [first, second] = await Promise.all([
    catalog.list({ ...query, items: 100 }),
    catalog.list({ ...query, items: 100 }),
  ]);
  assert.deepEqual(first, second);
  assert.equal(first.partial, true);
  assert.equal(first.total, 10);
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test("history rejects a disabled-chain detail before fetching records", async () => {
  let historyCalls = 0;
  const merkl = {
    ...provider(),
    getById: async () => ({
      ...row,
      chainId: 10143,
      description: "",
      action: "",
      type: "",
      dailyRewards: 0,
      liveCampaigns: 0,
      nativeApr: 0,
      explorerAddress: address,
      howToSteps: [],
      depositUrl: "",
      identifier: address,
      tags: [],
      tokens: [],
      campaigns: [],
    }),
    tvlRecords: async () => {
      historyCalls++;
      return [];
    },
  };
  const catalog = new ConfiguredOpportunities(chains, [], merkl, {
    lookup: async () => null,
  });
  await assert.rejects(
    catalog.tvlRecords({ id: "wrong-chain", items: 30 }),
    /not enabled/,
  );
  assert.equal(historyCalls, 0);
});
