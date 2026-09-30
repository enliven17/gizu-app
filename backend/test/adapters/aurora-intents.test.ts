import assert from "node:assert/strict";
import { test } from "node:test";
import { AuroraIntents } from "../../src/adapters/aurora/aurora-intents.ts";
import { InfrastructureError } from "../../src/domain/errors/infrastructure-error.ts";

type Seen = { url: string; method: string; body: unknown; authorization: string | null };

function fakeFetch(seen: Seen[], respond: (url: string) => Response): typeof fetch {
  return async (input, init) => {
    const url = String(input);
    seen.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      authorization: new Headers(init?.headers).get("Authorization"),
    });
    return respond(url);
  };
}

test("puts the key in the Aurora path and forwards the access token as a bearer", async () => {
  const seen: Seen[] = [];
  const aurora = new AuroraIntents("k/1", fakeFetch(seen, () => Response.json({ balances: [] })));
  await aurora.balances("session");
  assert.equal(seen[0]?.url, "https://intents-api.aurora.dev/api/account/balances/k%2F1");
  assert.equal(seen[0]?.authorization, "Bearer session");
});

test("builds the swap_transfer bodies from the research runner", async () => {
  const seen: Seen[] = [];
  const aurora = new AuroraIntents("key", fakeFetch(seen, () => Response.json({ ok: true })));
  await aurora.generateIntent("0xabc", "deposit");
  await aurora.submitIntent({ standard: "erc191", payload: "{}", signature: "secp256k1:x" });
  await aurora.status("deposit", "memo");
  assert.deepEqual(seen[0]?.body, { type: "swap_transfer", standard: "erc191", signerId: "0xabc", depositAddress: "deposit" });
  assert.deepEqual(seen[1]?.body, { type: "swap_transfer", signedData: { standard: "erc191", payload: "{}", signature: "secp256k1:x" } });
  assert.equal(seen[2]?.url, "https://intents-api.aurora.dev/api/status/key?depositAddress=deposit&depositMemo=memo");
});

test("maps provider failures without echoing the key", async () => {
  const rejected = new AuroraIntents("secret", async () => Response.json({ message: "amount secret too low" }, { status: 400 }));
  await assert.rejects(rejected.quote({}), (error: unknown) => {
    assert.ok(error instanceof InfrastructureError);
    assert.equal(error.code, "AURORA_REJECTED");
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  const unauthorized = new AuroraIntents("secret", async () => new Response("", { status: 401 }));
  await assert.rejects(unauthorized.authenticate("{}", "secp256k1:x"), (error: unknown) =>
    error instanceof InfrastructureError && error.code === "AURORA_UNAUTHORIZED");
  const down = new AuroraIntents("secret", async () => new Response("", { status: 502 }));
  await assert.rejects(down.tokens(), (error: unknown) => error instanceof InfrastructureError && error.statusCode === 503);
});

test("reads the public Intents salt from the NEAR view call", async () => {
  const bytes = [...Buffer.from(JSON.stringify("252812B3"))];
  const aurora = new AuroraIntents("key", async () => Response.json({ result: { result: bytes } }));
  assert.equal(await aurora.authSalt(), "252812b3");
  const invalid = new AuroraIntents("key", async () => Response.json({ result: { result: [...Buffer.from('"xyz"')] } }));
  await assert.rejects(invalid.authSalt(), InfrastructureError);
});

test("keeps well-formed tokens and caches the registry for 10 minutes", async () => {
  const seen: Seen[] = [];
  const aurora = new AuroraIntents("key", fakeFetch(seen, () => Response.json({ tokens: [
    { assetId: "a", blockchain: "monad", symbol: "USDC", decimals: 6, contractAddress: "0x754704bc059f8c67012fed69bc8a327a5aafb603" },
    { assetId: "b", blockchain: "near" },
  ] })));
  const originalNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    assert.deepEqual((await aurora.tokens()).map((token) => token.assetId), ["a"]);
    now = 599_999;
    await aurora.tokens();
    assert.equal(seen.length, 1);
  } finally {
    Date.now = originalNow;
  }
});
