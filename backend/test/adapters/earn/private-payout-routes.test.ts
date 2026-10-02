import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { PrivatePayoutGateway } from "../../../src/adapters/earn/private-payout.ts";
import { registerEarnPayoutRoutes } from "../../../src/http/routes/earn-payout.routes.ts";
test("private payout routes sanitize malformed input and unknown cached signed payout", async () => {
  const app = Fastify({ logger: false });
  registerEarnPayoutRoutes(app, new PrivatePayoutGateway({}));
  const prepare = await app.inject({
    method: "POST",
    url: "/v1/earn/native/payout/prepare",
    payload: { signedData: "private-signed-payload" },
  });
  assert.equal(prepare.statusCode, 400);
  assert.equal(prepare.body.includes("private-signed-payload"), false);
  assert.equal(prepare.headers["cache-control"], "no-store");
  const submit = await app.inject({
    method: "POST",
    url: "/v1/earn/native/payout/submit",
    payload: {},
  });
  assert.equal(submit.statusCode, 400);
  const malformed = await app.inject({
    method: "POST",
    url: "/v1/earn/native/payout/settlement",
    headers: { "content-type": "application/json" },
    payload: '{"secret-signed-body":',
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(malformed.body.includes("secret-signed-body"), false);
  await app.close();
});
test("native payout recovery routes accept bounded encrypted envelopes above the old small-auth limit", async () => {
  let received: unknown;
  const gateway = {
    prepare: async (body: unknown) => {
      received = body;
      return { status: "awaitingNativeAuthorization" };
    },
  } as unknown as PrivatePayoutGateway;
  const app = Fastify({ logger: false });
  registerEarnPayoutRoutes(app, gateway);
  const payload = { recoveryEnvelope: "v1." + "A".repeat(16000) };
  const response = await app.inject({
    method: "POST",
    url: "/v1/earn/native/payout/prepare",
    payload,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(received, payload);
  assert.equal(response.headers["cache-control"], "no-store");
  const tooLarge = await app.inject({
    method: "POST",
    url: "/v1/earn/native/payout/prepare",
    payload: { recoveryEnvelope: "A".repeat(300000) },
  });
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(tooLarge.body.includes("A".repeat(100)), false);
  await app.close();
});

test("withdrawal routes are native-private, bounded and sanitize malformed or unknown withdrawal bodies", async () => {
  const app = Fastify({ logger: false });
  registerEarnPayoutRoutes(app, new PrivatePayoutGateway({}));
  for (const route of ["prepare", "submit", "status"]) {
    const response = await app.inject({
      method: "POST",
      url: `/v1/earn/native/withdrawal/${route}`,
      payload: { signedData: "private-withdrawal-auth" },
    });
    assert.equal(response.statusCode, 400);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.body.includes("private-withdrawal-auth"), false);
  }
  await app.close();
});
