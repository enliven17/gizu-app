import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
} from "@fastify/type-provider-zod";
import { registerEarnPreviewRoutes } from "../../src/http/routes/earn-preview.routes.ts";
const address = "0x1000000000000000000000000000000000000001";
test("preview route fails closed before any funding when provider is unavailable", async () => {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerEarnPreviewRoutes(
    app,
    {
      preview: async () => {
        throw new Error("provider error with secret");
      },
    },
    {
      preview: async () => {
        throw new Error("unqualified");
      },
    },
  );
  try {
    const response = await app.inject({
      method: "POST",
      url: "/v1/earn/robinhood/deposit-preview",
      payload: {
        owner: address,
        expectedUsdgAtoms: "1000000",
        operationId: "preview",
        revision: 1,
      },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().code, "EARN_DEPOSIT_PREVIEW_UNAVAILABLE");
    assert.ok(!response.body.includes("secret"));
    assert.equal(response.headers["cache-control"], "no-store");
    const invalid = await app.inject({
      method: "POST",
      url: "/v1/earn/native/payout/preview",
      payload: {
        profileChainId: 143,
        confidentialAccount: address,
        recipient: address,
        amountAtoms: "-1",
        operationId: "p",
        revision: 1,
        leg: "invest",
      },
    });
    assert.equal(invalid.statusCode, 400);
  } finally {
    await app.close();
  }
});
