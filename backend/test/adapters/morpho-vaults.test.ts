import assert from "node:assert/strict";
import { test } from "node:test";
import { MorphoVaults } from "../../src/adapters/catalog/morpho-vaults.ts";
const address = "0x1111111111111111111111111111111111111111";
test("a missing version cannot null out the existing version", async () => {
  const fetchImpl = (async (_url: unknown, options: RequestInit) => {
    const { query } = JSON.parse(options.body as string);
    if (query.includes("vaultByAddress"))
      return Response.json({ data: null, errors: [{ message: "NOT_FOUND" }] });
    return Response.json({ data: { v2: { address, name: "V2 only" } } });
  }) as typeof fetch;
  assert.equal(
    (await new MorphoVaults(undefined, fetchImpl).lookup(143, address))?.name,
    "V2 only",
  );
});
test("reads public V1 and V2 metadata, preserving missing metrics and partial GraphQL results", async () => {
  for (const version of ["v1", "v2"]) {
    const fetchImpl = (async (_url: unknown, options: RequestInit) => {
      const request = JSON.parse(options.body as string);
      assert.deepEqual(request.variables, { address, chainId: 143 });
      assert.deepEqual(options.headers, { "Content-Type": "application/json" });
      const metrics = { netApy: 0.05, totalAssetsUsd: 123 };
      return Response.json({
        data: {
          [version]: {
            address,
            name: "Live name",
            symbol: "vUSDC",
            ...(version === "v1" ? { state: metrics } : metrics),
          },
        },
        errors: [{ message: "Other version not found" }],
      });
    }) as typeof fetch;
    const metadata = await new MorphoVaults(
      "https://api.morpho.org/graphql",
      fetchImpl,
    ).lookup(143, address);
    assert.equal(metadata?.name, "Live name");
    assert.equal(metadata?.netApy, 0.05);
    assert.equal(metadata?.totalAssetsUsd, 123);
    assert.equal(metadata?.asset, undefined);
  }
});
test("unavailable, malformed and wrong-contract data fall back without invented metrics", async () => {
  for (const response of [
    new Response("down", { status: 503 }),
    Response.json({ data: { v1: null, v2: null }, errors: [{}] }),
    Response.json({
      data: {
        v1: {
          address: "0x2222222222222222222222222222222222222222",
          name: "Wrong",
        },
      },
    }),
    Response.json({ data: { v1: { address, state: { netApy: "5" } } } }),
  ]) {
    assert.equal(
      await new MorphoVaults(
        undefined,
        (async () => response) as typeof fetch,
      ).lookup(143, address),
      null,
    );
  }
  assert.equal(
    await new MorphoVaults(undefined, (async () => {
      throw new Error("timeout");
    }) as typeof fetch).lookup(143, address),
    null,
  );
});
