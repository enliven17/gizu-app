import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { validateFusionResponse } from "../../../src/adapters/earn/fusion-quote.ts";
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/fusion-response.json", import.meta.url),
    "utf8",
  ),
);
function response() {
  const r = structuredClone(fixture);
  r.quoteGeneratedAt = Date.now();
  r.presets.custom = {
    ...r.presets.fast,
    auctionStartAmount: "100000000000000",
    auctionEndAmount: "100000000000000",
    initialRateBump: 0,
    points: [],
    allowPartialFills: false,
    allowMultipleFills: false,
  };
  return r;
}
const params = {
  owner: "0x0000000000000000000000000000000000000001" as const,
  input: 2000000n,
  expectedEnd: 100000000000000n,
};
test("unsigned Fusion proposal validates native minimum net of protocol fees", () => {
  const p = validateFusionResponse(response(), params);
  assert.ok(p.minimumEth > 0n);
  assert.ok(p.minimumEth < p.grossEth);
  assert.match(p.orderHash, /^0x[0-9a-f]{64}$/);
  assert.ok(p.unsignedOrder);
  assert.ok(!("signature" in p));
});
test("hostile Fusion payload changes fail closed", () => {
  const changes = [
    (r: any) => (r.fromTokenAmount = "2000001"),
    (r: any) => (r.feeToken = "0x0000000000000000000000000000000000000001"),
    (r: any) => (r.presets.custom.allowPartialFills = true),
    (r: any) => (r.presets.custom.allowMultipleFills = true),
    (r: any) => (r.integratorFee = 1),
    (r: any) => (r.surplusFee = 1),
    (r: any) => (r.fee.receiver = "0x0000000000000000000000000000000000000001"),
    (r: any) =>
      (r.settlementAddress = "0x0000000000000000000000000000000000000001"),
    (r: any) => (r.presets.custom.auctionEndAmount = "100000000000001"),
    (r: any) => (r.quoteGeneratedAt = Date.now() - 60001),
    (r: any) => (r.whitelist = []),
  ];
  for (const change of changes) {
    const r = response();
    change(r);
    assert.throws(() => validateFusionResponse(r, params));
  }
});
test('provider uses unsigned GET then custom POST and validates final routing economics',async()=>{
 const {FusionQuoteProvider}=await import('../../../src/adapters/earn/fusion-quote.ts');
 const requests:{url:string;body:unknown;method:string}[]=[];
 const provider=new FusionQuoteProvider('server-secret',async(input,init)=>{
  const url=String(input);requests.push({url,body:init?.body,method:init?.method??'GET'});
  const r=response();if(init?.body){const p=JSON.parse(String(init.body));r.presets.custom={...r.presets.fast,...p,initialRateBump:0,bankFee:'0',startAuctionIn:0};}
  return new Response(JSON.stringify(r),{status:200});
 });
 const result=await provider.quote(params.owner,params.input,500000000n);
 assert.equal(requests.length,2);assert.equal(requests[0]!.method,'GET');assert.equal(requests[1]!.method,'POST');assert.ok(requests.every(r=>new URL(r.url).searchParams.get('enableEstimate')==='false'&&!new URL(r.url).searchParams.has('permit')));
 assert.ok(result.minimumEth>0n);assert.ok(result.economics.inputValueWei-result.grossEth-result.economics.gasCostWei>=result.economics.profitWei);assert.ok(!JSON.stringify(result.unsignedOrder).includes('server-secret'));
});
test('changed final provider gas economics fail rather than reporting the earlier allowance',async()=>{
 const {FusionQuoteProvider}=await import('../../../src/adapters/earn/fusion-quote.ts');
 const provider=new FusionQuoteProvider('server-secret',async(_input,init)=>{
  const r=response();if(init?.body){const p=JSON.parse(String(init.body));r.presets.custom={...r.presets.fast,...p,initialRateBump:0,bankFee:'0',startAuctionIn:0};r.gasLimit=2000000;}
  return new Response(JSON.stringify(r),{status:200});
 });
 await assert.rejects(provider.quote(params.owner,params.input,500000000n),/compensation changed/);
});
test('native executable Fusion quotes include the bounded permit and request real estimation',async()=>{
 const {FusionQuoteProvider}=await import('../../../src/adapters/earn/fusion-quote.ts');
 const urls:string[]=[];const permit='0x'+'00'.repeat(224);
 const provider=new FusionQuoteProvider('server-secret',async(input,init)=>{urls.push(String(input));const r=response();r.quoteId='executable-quote';if(init?.body){const p=JSON.parse(String(init.body));r.presets.custom={...r.presets.fast,...p,initialRateBump:0,bankFee:'0',startAuctionIn:0};}return new Response(JSON.stringify(r));});
 const p=await provider.quote(params.owner,params.input,500000000n,{permit,enableEstimate:true});
 assert.equal(p.quoteId,'executable-quote');assert.ok(urls.every(url=>new URL(url).searchParams.get('enableEstimate')==='true'&&new URL(url).searchParams.get('permit')===permit));
 // Private native permit is embedded into the protected SDK extension.
 assert.ok(p.extension!.toLowerCase().includes(permit.slice(2)));
});
