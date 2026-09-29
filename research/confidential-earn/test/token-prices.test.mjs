import test from 'node:test';
import assert from 'node:assert/strict';
import {readTokenPrices} from '../src/token-prices.mjs';
const now=1790706480000;
test('valuation bypasses a cached token listing and keeps the freshness check',async()=>{
 const result=await readTokenPrices({apiKey:'test-key',assetIds:['usd','eth'],now,fetcher:async(url,options)=>{
  assert.equal(new URL(url).searchParams.get('valuationAt'),String(now));assert.equal(options.headers['Cache-Control'],'no-cache');
  return Response.json({tokens:[{assetId:'usd',price:1.000243711,priceUpdatedAt:new Date(now-60000).toISOString()},{assetId:'eth',price:2687.0148,priceUpdatedAt:new Date(now-60000).toISOString()}]});
 }});assert.deepEqual(result,[1000244n,2687014800n]);
});
test('cache bypass does not make stale, missing or invalid source valuations acceptable',async()=>{
 for(const token of [{assetId:'usd',price:1,priceUpdatedAt:new Date(now-600000).toISOString()},{assetId:'usd',price:0,priceUpdatedAt:new Date(now).toISOString()},{assetId:'other',price:1,priceUpdatedAt:new Date(now).toISOString()}])await assert.rejects(readTokenPrices({apiKey:'key',assetIds:['usd'],now,fetcher:async()=>Response.json({tokens:[token]})}),/Stale|missing|invalid/i);
});
