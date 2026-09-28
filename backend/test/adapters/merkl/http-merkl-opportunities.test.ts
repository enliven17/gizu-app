import assert from "node:assert/strict";
import { test } from "node:test";
import { HttpMerklOpportunities } from "../../../src/adapters/merkl/http-merkl-opportunities.ts";
import { InfrastructureError } from "../../../src/domain/errors/infrastructure-error.ts";

test("passes the zero-based page through to Merkl", async () => {
  const urls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/count")) {
      return Response.json(1);
    }
    return Response.json([
      {
        id: "opportunity-1",
        name: "Aave USDC",
        status: "LIVE",
        apr: 4,
        totalApr: 4,
        tvl: 100,
        chainId: 143,
        chain: { id: 143, name: "Monad" },
        protocol: { id: "aave", name: "Aave" },
      },
    ]);
  };
  const adapter = new HttpMerklOpportunities(
    "https://api.merkl.xyz",
    "test-key",
    fetchImpl,
  );

  const result = await adapter.list({
    protocol: "all",
    search: "USDC",
    page: 0,
    items: 20,
    chainId: 143,
  });

  assert.equal(result.total, 1);
  assert.equal(result.list[0]?.id, "opportunity-1");
  assert.equal(urls[0]?.searchParams.get("page"), "0");
  assert.equal(urls[0]?.searchParams.get("mainProtocolId"), "aave,morpho,curvance");
  assert.equal(urls[1]?.searchParams.get("mainProtocolId"), "aave,morpho,curvance");
});

test("scopes both Merkl list and count to the requested protocol", async () => {
  const urls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.pathname.endsWith("/count")) {
      return Response.json(0);
    }
    return Response.json([]);
  };
  const adapter = new HttpMerklOpportunities(
    "https://api.merkl.xyz",
    "test-key",
    fetchImpl,
  );

  await adapter.list({
    protocol: "curvance",
    search: "USDC",
    page: 0,
    items: 20,
    chainId: 143,
  });

  assert.equal(urls[0]?.searchParams.get("mainProtocolId"), "curvance");
  assert.equal(urls[1]?.searchParams.get("mainProtocolId"), "curvance");
  assert.equal(urls[0]?.searchParams.get("search"), "USDC");
  assert.equal(urls[1]?.searchParams.get("search"), "USDC");
});

test("rejects malformed vendor JSON as an upstream failure", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response("not json", { status: 200 });
  const adapter = new HttpMerklOpportunities(
    "https://api.merkl.xyz",
    "test-key",
    fetchImpl,
  );

  await assert.rejects(
    adapter.tvlRecords({ id: "opportunity-1", items: 10 }),
    (error: unknown) => {
      assert.ok(error instanceof InfrastructureError);
      assert.equal(error.code, "MERKL_UNAVAILABLE");
      assert.equal(error.statusCode, 503);
      return true;
    },
  );
});
