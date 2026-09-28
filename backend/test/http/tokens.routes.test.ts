import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { serializerCompiler, validatorCompiler } from "@fastify/type-provider-zod";
import { registerTokenRoutes } from "../../src/http/routes/tokens.routes.ts";

test("GET /v1/tokens filters, paginates, and validates explicit query fields", async () => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerTokenRoutes(app, { list: async () => [
    { chainId: 143, address: "0x1111111111111111111111111111111111111111", symbol: "AAPLx", name: "Apple xStock", decimals: 18, logoURI: null, category: "rwa", issuer: null, swapListed: true, fusionStatus: "quote-required" },
    { chainId: 143, address: "0x2222222222222222222222222222222222222222", symbol: "MSFTx", name: "Microsoft xStock", decimals: 18, logoURI: null, category: "rwa", issuer: null, swapListed: true, fusionStatus: "quote-required" },
    { chainId: 143, address: "0x3333333333333333333333333333333333333333", symbol: "USDC", name: "USD Coin", decimals: 6, logoURI: null, category: "other", issuer: null, swapListed: true, fusionStatus: "quote-required" },
  ] });
  const good = await app.inject("/v1/tokens?chainId=143&category=rwa&search=xstock&page=1&items=1");
  assert.equal(good.statusCode, 200);
  assert.deepEqual({ symbols: good.json().list.map((token: {symbol: string}) => token.symbol), total: good.json().total, page: good.json().page, items: good.json().items }, {
    symbols: ["MSFTx"], total: 2, page: 1, items: 1,
  });
  const bad = await app.inject("/v1/tokens?chainId=999&category=all&search=&page=0&items=60");
  assert.equal(bad.statusCode, 400);
  const missingCategory = await app.inject("/v1/tokens?chainId=143&search=&page=0&items=60");
  assert.equal(missingCategory.statusCode, 400);
  const badItems = await app.inject("/v1/tokens?chainId=143&category=all&search=&page=0&items=101");
  assert.equal(badItems.statusCode, 400);
  await app.close();
});
