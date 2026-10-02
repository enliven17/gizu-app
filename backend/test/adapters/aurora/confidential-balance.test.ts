import assert from "node:assert/strict";
import { test } from "node:test";
import { privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";
import { base58 } from "@scure/base";
import { ConfidentialBalance } from "../../../src/adapters/aurora/confidential-balance.ts";
// Publicly known test key; this adapter never receives an execution key.
const account=privateKeyToAccount(("0x" + "1".repeat(64)) as `0x${string}`);
const now=Date.parse("2026-09-30T10:00:00.000Z");
async function authentication(change: Record<string,unknown>={}) {
  const nonce=Buffer.alloc(32); Buffer.from("5628f6c600","hex").copy(nonce);
  nonce.writeBigUInt64LE(BigInt(now+300000)*1000000n,9);nonce.writeBigUInt64LE(BigInt(now)*1000000n,17);
  const message={signer_id:account.address.toLowerCase(),verifying_contract:"intents.near",deadline:new Date(now+300000).toISOString(),nonce:nonce.toString("base64"),intents:[],...change};
  const payload=JSON.stringify(Object.fromEntries(Object.entries(message).sort(([a],[b])=>a.localeCompare(b))));
  const bytes=hexToBytes(await account.signMessage({message:payload})); bytes[64]!-=27;
  return {standard:"erc191" as const,payload,signature:"secp256k1:"+base58.encode(bytes)};
}
const assetId="nep245:v2_1.omni.hot.tg:143_2dmLwYWkCQKyTjeUPAsGJuiVLbFx";
function setup(change: (path:string, result:Record<string,unknown>)=>void=()=>{}) {
  const calls: {url:string;init?:RequestInit}[]=[];
  const fetcher=async(url: string | URL | Request,init?:RequestInit)=>{
    calls.push({url:String(url),init});
    const path=new URL(String(url)).pathname;
    const result: Record<string,unknown>=path.includes("authenticate")?{accessToken:"private-token"}:path.includes("tokens")?{tokens:[{assetId,blockchain:"monad",symbol:"USDC",decimals:6,contractAddress:"0x754704Bc059F8C67012fEd69BC8A327a5aafb603"}]}:{balances:[{source:"private",tokenId:assetId,available:"1234567"}]};
    change(path,result);
    return new Response(JSON.stringify(result),{status:200});
  };
  return {adapter:new ConfidentialBalance("test-provider-key",fetcher,()=>now),calls};
}
test("read authenticates the signature, keeps tokens server-side and marks balance non-settlement",async()=>{
  const {adapter,calls}=setup(); const result=await adapter.read(await authentication());
  assert.deepEqual(result,{confidentialAddress:account.address.toLowerCase(),assetId,available:"1234567",timestampMs:now,authenticated:true,operationScoped:false});
  assert.equal(calls.length,3);
  const balanceCall=calls.find(c=>c.url.includes("balances"));
  assert.ok(balanceCall?.url.includes("tokenIds="+encodeURIComponent(assetId)));
  assert.equal((balanceCall?.init?.headers as Record<string,string>).Authorization,"Bearer private-token");
  assert.ok(!JSON.stringify(result).includes("private-token"));
});
test("spending/changed authentication, stale nonce and invalid signature reject before providers",async()=>{
  const {adapter,calls}=setup();
  for(const change of [{verifying_contract:"intents.far"},{intents:[{intent:"transfer"}]},{signer_id:"0x"+"2".repeat(40)},{deadline:new Date(now+1000000).toISOString()},{nonce:"AAAA"},{extra:true}]) await assert.rejects(adapter.read(await authentication(change)));
  await assert.rejects(adapter.read({...await authentication(),signature:"secp256k1:111"}));
  assert.equal(calls.length,0);
});
test("missing credentials, duplicate assets, wrong balance source and invalid amounts fail closed",async()=>{
  const auth=await authentication(); await assert.rejects(new ConfidentialBalance().read(auth));
  for (const change of [
    (p:string,r:Record<string,unknown>)=>{if(p.includes("tokens")) r.tokens=[...(r.tokens as unknown[]),...(r.tokens as unknown[])];},
    (p:string,r:Record<string,unknown>)=>{if(p.includes("balances")) r.balances=[{source:"public",tokenId:assetId,available:"1"}];},
    (p:string,r:Record<string,unknown>)=>{if(p.includes("balances")) r.balances=[{source:"private",tokenId:assetId,available:"1e6"}];},
  ]) await assert.rejects(setup(change).adapter.read(auth));
});
