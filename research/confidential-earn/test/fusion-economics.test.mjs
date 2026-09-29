import test from 'node:test';
import assert from 'node:assert/strict';
import * as economics from '../src/fusion-bootstrap.mjs';
import {readFile} from 'node:fs/promises';
const fixture=JSON.parse(await readFile(new URL('../fixtures/fusion-live-quote.json',import.meta.url),'utf8'));
const response={...fixture.response,gas:300000,gasLimit:300000,prices:{usd:{fromToken:'1',toToken:'2500'}}};
test('resolver allowance scales with gas and preserves profit after the stated gas/fee headroom',()=>{
 assert.equal(typeof economics.resolverBudget,'function');
 const b=economics.resolverBudget({response,input:3000000n,gasPrice:800000000n});
 // 300k gas * 1.2 * (0.8 gwei * 1.25) = .00036 ETH; profit = 10% of that.
 assert.equal(b.gasUnits,360000n);assert.equal(b.gasPrice,1000000000n);
 assert.equal(b.gasCostWei,360000000000000n);assert.equal(b.profitWei,36000000000000n);
 assert.equal(b.inputValueWei,1200000000000000n);assert.equal(b.maximumGrossEth,804000000000000n);
 const higher=economics.resolverBudget({response,input:3000000n,gasPrice:1600000000n});
 assert.equal(higher.allowanceWei,b.allowanceWei*2n);
 assert.throws(()=>economics.resolverBudget({response:{...response,gas:undefined,gasLimit:undefined},input:3000000n,gasPrice:800000000n}),/gas estimate/i);
});
test('a provider underestimate cannot budget less gas than the exact previously replayed fill',()=>{
 assert.equal(typeof economics.resolverBudget,'function');
 const b=economics.resolverBudget({response:{...response,gas:10000,gasLimit:10000},input:3000000n,gasPrice:800000000n});
 assert(b.gasUnits>=202859n);assert(b.maximumGrossEth<b.inputValueWei);
});
test('custom quote budgets resolver cost and includes the actual signed gross payment, not just net ETH',async()=>{
 const requests=[];
 const fetcher=async(url,options)=>{
  requests.push({url,options});
  const data={...structuredClone(response),fromTokenAmount:'3000000',quoteGeneratedAt:Date.now()};
  if(options.method==='POST'){
   const body=JSON.parse(options.body);
   data.presets.custom={...data.presets.fast,...body,initialRateBump:0,points:[],gasCost:{gasBumpEstimate:0,gasPriceEstimate:'0'}};
  }
  return Response.json(data);
 };
 const q=await economics.quoteNativeEth({owner:fixture.params.walletAddress,input:3000000n,apiKey:'test',resolverGasPrice:800000000n,fetcher});
 assert.equal(requests.length,2,'must obtain a custom provider quote');
 assert.equal(q.preset,'custom');assert(q.economics.grossEth<=804000000000000n);
 assert(q.economics.profitAtBudgetWei>=36000000000000n);
 assert(q.minimumEth<804000000000000n,'protocol fee also comes out of gross output budget');
 const posted=JSON.parse(requests[1].options.body);
 assert.equal(posted.auctionStartAmount,posted.auctionEndAmount);
 assert.equal(posted.allowMultipleFills,false);assert.equal(posted.allowPartialFills,false);
 const rebuilt=economics.orderFromQuote(q);assert.equal(rebuilt.minimumEth,q.minimumEth);
});
test('a changed provider custom response cannot sneak an uneconomic order past the final check',async()=>{
 let n=0;
 await assert.rejects(economics.quoteNativeEth({owner:fixture.params.walletAddress,input:3000000n,apiKey:'test',resolverGasPrice:800000000n,fetcher:async()=>{
  const data={...structuredClone(response),fromTokenAmount:'3000000',quoteGeneratedAt:Date.now()};
  if(n++)data.presets.custom={...data.presets.fast,auctionEndAmount:'1200000000000000',auctionStartAmount:'1200000000000000',initialRateBump:0,points:[],gasCost:{gasBumpEstimate:0,gasPriceEstimate:'0'}};
  return Response.json(data);
 }}),/resolver.*budget|custom.*amount/i);
});
test('an estimated permit quote retains the more conservative gas estimate from preview',()=>{
 const b=economics.resolverBudget({response:{...response,gas:210000,gasLimit:210000},input:3000000n,gasPrice:800000000n,minimumResolverGas:400000n});
 assert.equal(b.gasUnits,480000n);
});
test('funding selection adds execution overhead without scaling the entire swap by the net-output ratio',async()=>{
 const {selectBootstrapQuote}=await import('../src/native-gas.mjs');
 const result=await selectBootstrapQuote({requiredEth:1000n,maxInput:5000n,initialInput:1000n,quote:async input=>({input,minimumEth:input-800n,economics:{inputValueWei:input}})});
 assert(result.input>=1800n&&result.input<1900n,'fixed execution overhead must not inflate the purchase to the maximum balance');
});
test('small price drift between quote requests uses bounded price headroom rather than blocking every attempt',async()=>{
 let n=0;
 const q=await economics.quoteNativeEth({owner:fixture.params.walletAddress,input:3000000n,apiKey:'test',resolverGasPrice:800000000n,fetcher:async(_url,options)=>{
  const data={...structuredClone(response),fromTokenAmount:'3000000',quoteGeneratedAt:Date.now()};
  if(n++){
   const body=JSON.parse(options.body);data.prices.usd.fromToken='0.999';
   data.presets.custom={...data.presets.fast,...body,initialRateBump:0,points:[],gasCost:{gasBumpEstimate:0,gasPriceEstimate:'0'}};
  }
  return Response.json(data);
 }});
 assert(q.economics.profitAtBudgetWei>=q.economics.profitWei);
});
