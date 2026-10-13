import assert from "node:assert/strict";
import test from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";
import { base58 } from "@scure/base";
import { ConfidentialSettlement } from "../../../src/adapters/aurora/settlement.ts";
import { EarnRecoveryEnvelope } from "../../../src/adapters/earn/recovery-envelope.ts";
import { monadUsdcAssetId } from "../../../src/adapters/aurora/assets.ts";
const now = Date.parse("2026-10-12T10:00:00Z"),
  key = "11".repeat(32),
  account = privateKeyToAccount(("0x" + "1".repeat(64)) as `0x${string}`);
const C = account.address.toLowerCase(),
  owner = "0x" + "2".repeat(40),
  deposit = "0x" + "3".repeat(40),
  tx = "0x" + "a".repeat(64);
async function auth() {
  const nonce = Buffer.alloc(32);
  Buffer.from("5628f6c600", "hex").copy(nonce);
  nonce.writeBigUInt64LE(BigInt(now + 300000) * 1000000n, 9);
  nonce.writeBigUInt64LE(BigInt(now) * 1000000n, 17);
  const payload = JSON.stringify({
    deadline: new Date(now + 300000).toISOString(),
    intents: [],
    nonce: nonce.toString("base64"),
    signer_id: C,
    verifying_contract: "intents.near",
  });
  const bytes = hexToBytes(await account.signMessage({ message: payload }));
  bytes[64]! -= 27;
  return {
    standard: "erc191" as const,
    payload,
    signature: "secp256k1:" + base58.encode(bytes),
  };
}
function setup() {
  let balance = "100",
    status = "SUCCESS";
  const calls: string[] = [];
  const fetcher: typeof fetch = async (url) => {
    const path = String(url);
    calls.push(path);
    if (path.includes("history")) throw Error("History is invite-only for now");
    return new Response(
      JSON.stringify(
        path.includes("authenticate")
          ? { accessToken: "jwt" }
          : path.includes("/status/")
            ? { status }
            : path.includes("/account/balances/")
              ? {
                  balances: [
                    {
                      source: "private",
                      tokenId: monadUsdcAssetId,
                      available: balance,
                    },
                  ],
                }
              : {
                  tokens: [
                    {
                      assetId: monadUsdcAssetId,
                      blockchain: "monad",
                      symbol: "USDC",
                      decimals: 6,
                      contractAddress:
                        "0x754704bc059f8c67012fed69bc8a327a5aafb603",
                    },
                  ],
                },
      ),
    );
  };
  const service = () =>
    new ConfidentialSettlement("api-key", fetcher, () => now, key);
  const quote = {
    operationId: "fund_1",
    revision: 1,
    recipient: deposit,
    confidentialAccount: C,
    refundOwner: owner,
    originAsset: monadUsdcAssetId,
    destinationAsset: monadUsdcAssetId,
    amountAtoms: "1000000",
    minimumCreditAtoms: "990000",
    maximumCreditAtoms: "995000",
    quoteCreatedAt: now / 1000,
    expiresAt: now / 1000 + 600,
  };
  const quoteEnvelope = new EarnRecoveryEnvelope(key).seal("native-quote", {
    quote,
    settlement: quote,
  });
  const expected = {
    operationId: "fund_1",
    revision: 2,
    depositAddress: deposit,
    sourceOwner: owner,
    confidentialAccount: C,
    originAsset: monadUsdcAssetId,
    amountAtoms: "1000000",
    minimumCreditAtoms: "990000",
    transactionHash: tx,
    quoteEnvelope,
  };
  return {
    service,
    expected,
    calls,
    setBalance: (v: string) => {
      balance = v;
    },
    setStatus: (v: string) => {
      status = v;
    },
  };
}
test("new settlement uses exact route and authenticated balance delta; portable credit survives consumption and restart", async () => {
  const f = setup(),
    signed = await auth(),
    baseline = await f.service().baseline(signed);
  f.setBalance("995100");
  const expected = {
    ...f.expected,
    baselineEnvelope: baseline.baselineEnvelope,
  };
  const proof = await f.service().read(signed, expected);
  assert.equal(proof.creditedAtoms, "995000");
  assert.equal(proof.status, "credited");
  assert.ok("settlementEnvelope" in proof);
  if (!("settlementEnvelope" in proof))
    throw Error("Missing credit attestation");
  f.setBalance("0");
  const restored = await f
    .service()
    .read(signed, {
      ...expected,
      settlementEnvelope: proof.settlementEnvelope,
    });
  assert.equal(restored.creditedAtoms, "995000");
  assert.ok(!f.calls.some((p) => p.includes("history")));
  await assert.rejects(
    f
      .service()
      .read(signed, {
        ...expected,
        sourceOwner: deposit,
        settlementEnvelope: proof.settlementEnvelope,
      }),
  );
  await assert.rejects(
    f
      .service()
      .read(signed, {
        ...expected,
        baselineEnvelope: baseline.baselineEnvelope + "a",
      }),
  );
});
test("pending, missing, reduced and excess balances never become source credit", async () => {
  const f = setup(),
    signed = await auth(),
    baseline = await f.service().baseline(signed),
    expected = { ...f.expected, baselineEnvelope: baseline.baselineEnvelope };
  f.setStatus("PROCESSING");
  f.setBalance("995100");
  assert.equal((await f.service().read(signed, expected)).creditedAtoms, "0");
  f.setStatus("SUCCESS");
  f.setBalance("100");
  assert.equal(
    (await f.service().read(signed, expected)).status,
    "awaitingSettlement",
  );
  f.setBalance("99");
  await assert.rejects(f.service().read(signed, expected));
  f.setBalance("995101");
  await assert.rejects(f.service().read(signed, expected));
});

test("wrong-owner snapshots, mismatched saved quotes and manufactured late baselines cannot qualify credit", async () => {
  const f = setup(),
    signed = await auth(),
    baseline = await f.service().baseline(signed);
  f.setBalance("995100");
  const expected = {
    ...f.expected,
    baselineEnvelope: baseline.baselineEnvelope,
  };
  for (const patch of [
    { transactionHash: "bad" },
    { depositAddress: owner },
    { amountAtoms: "1000001" },
    { minimumCreditAtoms: "990001" },
    { maximumCreditAtoms: "995001" },
    { confidentialAccount: owner },
  ])
    await assert.rejects(f.service().read(signed, { ...expected, ...patch }));
  const envelope = new EarnRecoveryEnvelope(key);
  const wrong = envelope.seal("private-balance", {
    ...baseline,
    confidentialAddress: owner,
  });
  await assert.rejects(
    f.service().read(signed, { ...expected, baselineEnvelope: wrong }),
  );
  const late = envelope.seal("private-balance", {
    ...baseline,
    timestampMs: now + 601000,
  });
  await assert.rejects(
    f.service().read(signed, { ...expected, baselineEnvelope: late }),
  );
});
