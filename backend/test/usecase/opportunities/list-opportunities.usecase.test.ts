import assert from "node:assert/strict";
import { test } from "node:test";
import type { Cache } from "../../../src/ports/cache.port.ts";
import { ListOpportunitiesUseCase } from "../../../src/usecase/opportunities/list-opportunities.usecase.ts";

test("returns the page unchanged", async () => {
  const opportunity = {
    id: "1",
    name: "Lend USDC on Aave",
    status: "LIVE",
    apr: 4.75,
    totalApr: 4.75,
    tvl: 10,
    chainId: 143,
    chain: { id: 143, name: "Monad" },
    protocol: { id: "aave", name: "Aave" },
  };
  const page = { list: [opportunity], total: 1 };
  let writes = 0;
  const cache: Cache = {
    get: async () => null,
    set: async () => {
      writes += 1;
    },
    deleteExpired: async () => 0,
  };
  const useCase = new ListOpportunitiesUseCase(
    {
      list: async () => page,
      getById: async () => {
        throw new Error("unused");
      },
      tvlRecords: async () => [],
    },
    cache,
  );
  const result = await useCase.execute({
    protocol: "all",
    search: "USDC",
    page: 0,
    items: 20,
    chainId: 143,
  });
  assert.equal(result.total, 1);
  assert.equal(result.list.length, 1);
  assert.equal(result.list[0], opportunity);
  assert.equal(writes, 1);
});

test("returns the cached page without listing", async () => {
  const opportunity = {
    id: "1",
    name: "Lend USDC on Aave",
    status: "LIVE",
    apr: 4.75,
    totalApr: 4.75,
    tvl: 10,
    chainId: 143,
    chain: { id: 143, name: "Monad" },
    protocol: { id: "aave", name: "Aave" },
  };
  const page = { list: [opportunity], total: 1 };
  let lists = 0;
  const cache: Cache = {
    get: async <T>() => page as T,
    set: async () => {},
    deleteExpired: async () => 0,
  };
  const useCase = new ListOpportunitiesUseCase(
    {
      list: async () => {
        lists += 1;
        return page;
      },
      getById: async () => {
        throw new Error("unused");
      },
      tvlRecords: async () => [],
    },
    cache,
  );
  const result = await useCase.execute({
    protocol: "all",
    search: "USDC",
    page: 0,
    items: 20,
    chainId: 143,
  });
  assert.equal(result, page);
  assert.equal(lists, 0);
});

test("uses a separate cache key for each protocol filter", async () => {
  const keys: string[] = [];
  const cache: Cache = {
    get: async (key) => {
      keys.push(key);
      return null;
    },
    set: async () => {},
    deleteExpired: async () => 0,
  };
  const useCase = new ListOpportunitiesUseCase(
    {
      list: async () => ({ list: [], total: 0 }),
      getById: async () => {
        throw new Error("unused");
      },
      tvlRecords: async () => [],
    },
    cache,
  );
  const query = { search: "", page: 0, items: 20, chainId: 143 };

  await useCase.execute({ ...query, protocol: "aave" });
  await useCase.execute({ ...query, protocol: "morpho" });
  await useCase.execute({ ...query, protocol: "curvance" });

  assert.equal(new Set(keys).size, 3);
});
