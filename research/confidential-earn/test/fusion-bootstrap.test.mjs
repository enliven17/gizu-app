import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {Address,MakerTraits} from '@1inch/fusion-sdk';
import {orderFromQuote} from '../src/fusion-bootstrap.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/fusion-live-quote.json',import.meta.url),'utf8'));
const params={...fixture.params,enableEstimate:false};
test('live quote produces a full-fill native-ETH order whose minimum includes resolver fees',()=>{
 const {order,minimumEth,resolver}=orderFromQuote({params,response:fixture.response,nowMs:fixture.response.quoteGeneratedAt});
 assert.equal(order.makingAmount,2000000n);
 assert.equal(order.partialFillAllowed,false);
 assert.equal(order.multipleFillsAllowed,false);
 assert(new MakerTraits(BigInt(order.build().makerTraits)).isNativeUnwrapEnabled());
 const gross=order.calcTakingAmount(new Address(resolver),order.makingAmount,order.auctionEndTime,0n);
 assert(gross>minimumEth,'Resolver payment is gross; wallet receives net');
 assert(minimumEth>0n);
});
test('quote cannot silently change input, receiver asset, or allow partial fills',()=>{
 assert.throws(()=>orderFromQuote({params:{...params,amount:'1'},response:fixture.response,nowMs:fixture.response.quoteGeneratedAt}),/input/i);
 assert.throws(()=>orderFromQuote({params:{...params,toTokenAddress:'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'},response:fixture.response,nowMs:fixture.response.quoteGeneratedAt}),/native ETH/);
 const response=structuredClone(fixture.response);response.presets.fast.allowPartialFills=true;
 assert.throws(()=>orderFromQuote({params,response,nowMs:fixture.response.quoteGeneratedAt}),/Full-fill/);
});

test('order construction rejects stale economics and application fee collectors',()=>{
 assert.throws(()=>orderFromQuote({params,response:fixture.response,nowMs:fixture.response.quoteGeneratedAt+60001}),/stale/i);
 assert.throws(()=>orderFromQuote({params,response:{...fixture.response,integratorFee:100},nowMs:fixture.response.quoteGeneratedAt}),/application fee/i);
});
