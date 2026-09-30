import assert from "node:assert/strict";
import { test } from "node:test";
import {
  diagnosticAuroraFetch,
  type AuroraDiagnostic,
} from "../../src/adapters/aurora/diagnostics.ts";

test("diagnostics omit keyed URLs, headers, bodies and provider error text", async () => {
  const events: AuroraDiagnostic[] = [];
  const fetchImpl = diagnosticAuroraFetch(
    (event) => events.push(event),
    async () => Response.json({ message: "private-response" }, { status: 422 }),
  );
  const response = await fetchImpl(
    "https://intents-api.aurora.dev/api/quote/secret-key?depositAddress=private-address",
    {
      method: "POST",
      headers: { authorization: "Bearer private-token" },
      body: "private-signature",
    },
  );
  assert.equal(response.status, 422);
  assert.equal(events[0]?.operation, "quote");
  assert.equal(events[0]?.status, 422);
  assert.equal(events[0]?.outcome, "response");
  assert.equal(JSON.stringify(events).includes("private"), false);
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("transport failure logs status zero without serializing the exception", async () => {
  const events: AuroraDiagnostic[] = [];
  const cause = new Error("https://provider/secret-key");
  const fetchImpl = diagnosticAuroraFetch(
    (event) => events.push(event),
    async () => {
      throw cause;
    },
  );
  await assert.rejects(
    fetchImpl("https://rpc.mainnet.near.org"),
    (error) => error === cause,
  );
  assert.equal(events[0]?.operation, "auth-salt");
  assert.equal(events[0]?.status, 0);
  assert.equal(events[0]?.outcome, "transport_error");
  assert.equal(JSON.stringify(events).includes("secret"), false);
});

test("a failed diagnostic sink cannot change a provider result", async () => {
  const fetchImpl = diagnosticAuroraFetch(
    () => {
      throw new Error("sink");
    },
    async () => new Response("ok"),
  );
  assert.equal(
    await (
      await fetchImpl("https://intents-api.aurora.dev/api/tokens/key")
    ).text(),
    "ok",
  );
});
