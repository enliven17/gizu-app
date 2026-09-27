import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cache } from "../../../src/ports/cache.port.ts";
import type { OpportunityDetail } from "../../../src/ports/opportunities.port.ts";
import { GetOpportunityUseCase } from "../../../src/usecase/opportunities/get-opportunity.usecase.ts";

function campaign(id: string, startTimestamp: number, endTimestamp: number) {
  return {
    id,
    campaignId: id,
    type: "AAVE_SUPPLY",
    apr: 1,
    dailyRewards: 10,
    startTimestamp,
    endTimestamp,
    creatorAddress: "0x0",
  };
}

function detail(
  campaigns: OpportunityDetail["campaigns"],
): OpportunityDetail {
  return {
    id: "1",
    name: "Lend USDC on Aave",
    status: "LIVE",
    apr: 6.1,
    totalApr: 6.1,
    tvl: 10,
    chainId: 143,
    chain: { id: 143, name: "Monad" },
    protocol: { id: "aave", name: "Aave" },
    description: "",
    action: "LEND",
    type: "AAVE_SUPPLY",
    dailyRewards: 10,
    liveCampaigns: campaigns.length,
    nativeApr: 4,
    explorerAddress: "0x0",
    howToSteps: [],
    depositUrl: "",
    identifier: "1",
    tags: [],
    tokens: [],
    campaigns,
  };
}

test("returns only campaigns in the live window", async () => {
  const now = Math.floor(Date.now() / 1000);
  const opportunity = detail([
    campaign("ended", now - 1_209_600, now - 604_800),
    campaign("live", now - 60, now + 604_800),
    campaign("future", now + 604_800, now + 1_209_600),
  ]);
  const cache: Cache = {
    get: async () => null,
    set: async () => {},
    deleteExpired: async () => 0,
  };
  const useCase = new GetOpportunityUseCase(
    {
      list: async () => {
        throw new Error("unused");
      },
      getById: async () => opportunity,
      tvlRecords: async () => [],
    },
    cache,
  );

  const result = await useCase.execute("1");
  assert.deepEqual(
    result.campaigns.map((item) => item.id),
    ["live"],
  );
  assert.equal(result.liveCampaigns, 1);
});

test("filters live campaigns from a cached full list", async () => {
  const now = Math.floor(Date.now() / 1000);
  const opportunity = detail([
    campaign("ended", now - 1_209_600, now - 604_800),
    campaign("live", now - 60, now + 604_800),
  ]);
  let fetches = 0;
  const cache: Cache = {
    get: async <T>() => opportunity as T,
    set: async () => {},
    deleteExpired: async () => 0,
  };
  const useCase = new GetOpportunityUseCase(
    {
      list: async () => {
        throw new Error("unused");
      },
      getById: async () => {
        fetches += 1;
        return opportunity;
      },
      tvlRecords: async () => [],
    },
    cache,
  );

  const result = await useCase.execute("1");
  assert.equal(fetches, 0);
  assert.deepEqual(
    result.campaigns.map((item) => item.id),
    ["live"],
  );
  assert.equal(result.liveCampaigns, 1);
});
