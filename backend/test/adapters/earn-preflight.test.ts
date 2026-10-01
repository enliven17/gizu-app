import { test } from "node:test";
import assert from "node:assert/strict";
import { EarnPreflight } from "../../src/adapters/evm/earn-preflight.ts";
const owner = "0x" + "1".repeat(40);
const token = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const word = (n: bigint) => "0x" + n.toString(16).padStart(64,"0");
function setup(change: (row: Record<string, unknown>, method: string) => void = () => {}) {
  const calls: { url: string; body: { id: number; method: string; params: unknown[] }[] }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); calls.push({ url: String(url), body });
    const rows = body.map((r: { id: number; method: string; params: unknown[] }) => {
      let result: unknown;
      if (r.method === "eth_chainId") result = "0x1";
      else if (r.method === "eth_getBlockByNumber") result = { number: "0x100", hash: "0x" + "a".repeat(64), timestamp: "0x3e8", baseFeePerGas: "0x64", gasUsed: "0x64", gasLimit: "0xc8" };
      else if (r.method === "eth_getCode") result = "0x6000";
      else if (r.method === "eth_getBalance") result = "0x0";
      else if (r.method === "eth_feeHistory") result = { oldestBlock: "0xf9", reward: Array.from({length:8},(_,i)=>["0x"+(i+1).toString(16)]), baseFeePerGas: Array(9).fill("0x64"), gasUsedRatio: Array(8).fill(0.5) };
      else { const data = (r.params[0] as {data:string}).data; result = data === "0x313ce567" ? word(6n) : data === "0x38d52e0f" ? "0x" + token.slice(2).toLowerCase().padStart(64,"0") : word(0n); }
      const row: Record<string,unknown> = { jsonrpc: "2.0", id:r.id, result }; change(row, r.method); return row;
    });
    return new Response(JSON.stringify(rows.reverse()), { status: 200 });
  };
  return { adapter: new EarnPreflight(fetcher, () => 1000000), calls };
}
test("unsigned preflight pins chain/vault/token and every state read to its reference block", async () => {
  const { adapter, calls } = setup(); const r = await adapter.check("ethereum-usdc", owner);
  assert.equal(r.owner, owner); assert.equal(r.chainId, 1); assert.equal(r.tokenDecimals, 6);
  assert.equal(r.shares, "0"); assert.equal(r.readOnly, true); assert.equal(r.executionAvailable, false);
  assert.equal(r.blockNumber, "256"); assert.equal(r.timestampMs, 1000000);
  assert.equal(r.feeHistoryReward?.length, 8);
  assert.equal(calls.length, 3);
  assert.equal(r.blockHash, "0x" + "a".repeat(64));
  assert.equal(calls[1]?.body.find(r => r.method === "eth_feeHistory")?.params[1], "0x100");
  assert.ok(calls[1]?.body.filter(r => ["eth_getCode","eth_call","eth_getBalance"].includes(r.method)).every(r => JSON.stringify(r.params[1]) === JSON.stringify({ blockHash: "0x" + "a".repeat(64), requireCanonical: true })));
  assert.ok(calls.every(c => !c.body.some(r => /send|sign|authoriz/i.test(r.method))));
});
test("wrong chain, missing code, wrong vault asset/decimals and malformed RPC fail closed", async () => {
  const changes = [
    (r: Record<string,unknown>, m:string) => { if(m==="eth_chainId") r.result="0x8f"; },
    (r: Record<string,unknown>, m:string) => { if(m==="eth_getCode") r.result="0x"; },
    (r: Record<string,unknown>, m:string) => { if(m==="eth_call") r.result=word(18n); },
    (r: Record<string,unknown>, m:string) => { if(m==="eth_call") r.result="0x1"; },
    (r: Record<string,unknown>) => { r.id=1; },
    (r: Record<string,unknown>) => { r.error={code:-32000}; },
  ];
  for(const change of changes) await assert.rejects(setup(change).adapter.check("ethereum-usdc",owner));
  const { adapter, calls }=setup();
  await assert.rejects(adapter.check("arbitrary" as never,owner));
  await assert.rejects(adapter.check("ethereum-usdc","not-an-owner")); assert.equal(calls.length,0);
});
test("stale blocks and fee history disagreement are rejected", async () => {
  await assert.rejects(setup((r,m)=> { if(m==="eth_getBlockByNumber") (r.result as Record<string,unknown>).timestamp="0x1"; }).adapter.check("ethereum-usdc",owner));
  await assert.rejects(setup((r,m)=> { if(m==="eth_feeHistory") (r.result as Record<string,unknown>).oldestBlock="0xfa"; }).adapter.check("ethereum-usdc",owner));
});

test("a same-height reorg, missing hash, and malformed hash fail closed", async () => {
  let headers = 0;
  await assert.rejects(setup((row, method) => {
    if (method === "eth_getBlockByNumber" && ++headers === 2) (row.result as Record<string, unknown>).hash = "0x" + "b".repeat(64);
  }).adapter.check("ethereum-usdc", owner));
  for (const hash of [undefined, "0x1", "0x" + "0".repeat(64)]) {
    await assert.rejects(setup((row, method) => {
      if (method === "eth_getBlockByNumber") (row.result as Record<string, unknown>).hash = hash;
    }).adapter.check("ethereum-usdc", owner));
  }
});
