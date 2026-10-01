import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import {
  validatorCompiler,
  serializerCompiler,
} from "@fastify/type-provider-zod";
import { registerEarnExitRoutes } from "../../../src/http/routes/earn-exit.routes.ts";
test("exit reads only explicitly requested investment owner and rejects linked identities", async () => {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const calls: unknown[] = [];
  registerEarnExitRoutes(app, {
    read: async (input) => {
      calls.push(input);
      return { readOnly: true } as any;
    },
  });
  const body = {
    profileId: "robinhood-usdg",
    owner: "0x1000000000000000000000000000000000000001",
  };
  const r = await app.inject({
    method: "POST",
    url: "/v1/earn/exit-snapshot",
    payload: body,
  });
  assert.equal(r.statusCode, 200);
  assert.equal(r.headers["cache-control"], "no-store");
  for (const patch of [
    { confidentialAccount: body.owner },
    { holdOwner: body.owner },
    { rpcUrl: "https://evil.test" },
    { profileId: "monad" },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/earn/exit-snapshot",
          payload: { ...body, ...patch },
        })
      ).statusCode,
      400,
    );
  assert.deepEqual(calls, [body]);
  await app.close();
});
