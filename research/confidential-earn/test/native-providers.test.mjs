import test from 'node:test';
import assert from 'node:assert/strict';
import * as providers from '../src/native-providers.mjs';
test('Fusion submission uses only the saved order payload and treats uncertainty as unresolved',async()=>{
 const payload={order:{maker:'maker'},signature:'signature',extension:'extension',quoteId:'quote'};
 let body,url;
 await providers.submitFusion({apiKey:'secret',payload,fetcher:async(u,o)=>{url=u;body=JSON.parse(o.body);return new Response('',{status:200});}});
 assert.equal(url,'https://api.1inch.com/fusion/relayer/v2.0/1/order/submit');assert.deepEqual(body,payload);
 await assert.rejects(()=>providers.submitFusion({apiKey:'secret',payload:{...payload,quoteId:null},fetcher:()=>assert.fail('must not submit')}),/quoteId/);
 await assert.rejects(()=>providers.submitFusion({apiKey:'secret',payload,fetcher:async()=>{throw new Error('secret URL');}}),/uncertain/);
});
test('order status 404 is unknown, not proof of cancellation or failure',async()=>{
 assert.equal(await providers.fusionStatus({apiKey:'secret',hash:'0xabc',fetcher:async()=>new Response('',{status:404})}),null);
});
test('estimated Fusion quote includes permit and does not reuse the unsigned preview flag',async()=>{
 const {quoteNativeEth}=await import('../src/fusion-bootstrap.mjs');
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('../fixtures/fusion-live-quote.json',import.meta.url),'utf8'));
 let params;
 await quoteNativeEth({owner:fixture.params.walletAddress,input:2000000n,apiKey:'secret',permit:'0x',enableEstimate:true,fetcher:async url=>{
  params=new URL(url).searchParams;return Response.json({...fixture.response,quoteGeneratedAt:Date.now(),quoteId:'estimated'});
 }});
 assert.equal(params.get('enableEstimate'),'true');assert.equal(params.get('permit'),'0x');
});
test('production Fusion preparation cannot bypass resolver pricing when called without a fee plan',async()=>{
 await assert.rejects(providers.prepareFusion({client:{getBlock:()=>assert.fail('must reject before permit signing')},owner:{},input:1n,requiredEth:1n}),/resolver.*fee/i);
});
