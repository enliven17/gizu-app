import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultCatalogChains,
  resolveCatalogChains,
} from "../../src/domain/catalog.ts";

test("chain selection preserves legacy defaults and explicit metadata without VAULT_CHAINS", () => {
  assert.deepEqual(resolveCatalogChains({}), defaultCatalogChains);
  const configured = [{ id: 143, name: "Custom Monad" }];
  assert.deepEqual(
    resolveCatalogChains({ CATALOG_CHAINS_JSON: configured }),
    configured,
  );
});

test("VAULT_CHAINS uses known metadata in selected order despite a legacy Monad-only list", () => {
  assert.deepEqual(
    resolveCatalogChains({
      VAULT_CHAINS: [1, 4663],
      CATALOG_CHAINS_JSON: [{ id: 143, name: "Monad" }],
    }),
    [
      { id: 1, name: "Ethereum" },
      { id: 4663, name: "Robinhood" },
    ],
  );
});

test("selected custom metadata overrides names and requires known chain IDs", () => {
  assert.deepEqual(
    resolveCatalogChains({
      VAULT_CHAINS: [8453, 1],
      CATALOG_CHAINS_JSON: [
        { id: 8453, name: "Base" },
        { id: 1, name: "Custom Ethereum" },
      ],
    }),
    [
      { id: 8453, name: "Base" },
      { id: 1, name: "Custom Ethereum" },
    ],
  );
  assert.throws(
    () => resolveCatalogChains({ VAULT_CHAINS: [999999] }),
    /VAULT_CHAINS: unknown chain/,
  );
});
