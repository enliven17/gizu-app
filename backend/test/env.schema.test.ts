import assert from "node:assert/strict";
import { test } from "node:test";
import { parseApiEnv } from "../src/env.schema.ts";

const databaseUrl =
  "postgres://private_investment:private_investment@localhost:54329/private_investment";

const apiEnv = {
  NODE_ENV: "local",
  PORT: "3000",
  DATABASE_URL: databaseUrl,
  MERKL_API_URL: "https://api.merkl.xyz",
  MERKL_API_KEY: "merkl-api-key",
  ONEINCH_API_KEY: "oneinch-api-key",
};

test("parses a complete api env", () => {
  assert.deepEqual(parseApiEnv(apiEnv), {
    NODE_ENV: "local",
    PORT: 3000,
    DATABASE_URL: databaseUrl,
    MERKL_API_URL: "https://api.merkl.xyz",
    MERKL_API_KEY: "merkl-api-key",
    ONEINCH_API_KEY: "oneinch-api-key",
  });
});

test("rejects a missing 1inch key", () => {
  const { ONEINCH_API_KEY: _key, ...withoutKey } = apiEnv;
  assert.throws(() => parseApiEnv(withoutKey), /ONEINCH_API_KEY/);
});

test("rejects a missing database url", () => {
  const withoutDatabase = {
    NODE_ENV: apiEnv.NODE_ENV,
    PORT: apiEnv.PORT,
  };
  assert.throws(
    () => parseApiEnv(withoutDatabase),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes("DATABASE_URL") &&
      err.message.includes("invalid env"),
  );
});

test("rejects an empty database url", () => {
  assert.throws(
    () => parseApiEnv({ ...apiEnv, DATABASE_URL: "" }),
    (err: unknown) =>
      err instanceof Error && err.message.includes("DATABASE_URL"),
  );
});

test("rejects development as node env", () => {
  assert.throws(
    () => parseApiEnv({ ...apiEnv, NODE_ENV: "development" }),
    (err: unknown) =>
      err instanceof Error && err.message.includes("NODE_ENV"),
  );
});
