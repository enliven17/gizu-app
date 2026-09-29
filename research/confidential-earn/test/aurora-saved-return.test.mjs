import test from 'node:test';import assert from 'node:assert/strict';import {quoteAuroraReturn} from '../src/aurora-return.mjs';
const owner='0x1111111111111111111111111111111111111111',confidential='0x2222222222222222222222222222222222222222';
const args={apiKey:'test',owner,confidential,originAsset:'usd-g',destinationAsset:'usdc',amount:2650000n};
const quotedResponse=()=>({signature:'provider-signature',quoteRequest:{swapType:'EXACT_INPUT',depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:confidential,refundType:'ORIGIN_CHAIN',refundTo:owner,originAsset:'usd-g',destinationAsset:'usdc',amount:'2650000',confidentiality:'advanced'},quote:{depositAddress:'0x3333333333333333333333333333333333333333',amountIn:'2650000',minAmountOut:'2600000',deadline:new Date(Date.now()+600000).toISOString()}});
test('saved return quote is bound to the same assets, amount, confidential recipient and refund owner',async t=>{
 t.mock.method(globalThis,'fetch',()=>assert.fail('saved quote should not be regenerated'));
 const q=await quoteAuroraReturn({...args,quotedResponse:quotedResponse()});assert.equal(q.minimumOut,2600000n);
 for(const [field,value] of [['destinationAsset','other'],['recipient',owner],['refundTo',confidential],['amount','1'],['confidentiality','basic']]){const r=quotedResponse();r.quoteRequest[field]=value;await assert.rejects(quoteAuroraReturn({...args,quotedResponse:r}),/changed/);}
 const expired=quotedResponse();expired.quote.deadline=new Date(Date.now()-1000).toISOString();await assert.rejects(quoteAuroraReturn({...args,quotedResponse:expired}),/deadline/);
});
test('saved quote expires at its request deadline even if deposit address stays active longer',async()=>{
 const r=quotedResponse();r.quoteRequest.deadline=new Date(Date.now()-1000).toISOString();await assert.rejects(quoteAuroraReturn({...args,quotedResponse:r}),/deadline/i);
});
