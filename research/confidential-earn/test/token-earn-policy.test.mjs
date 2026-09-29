import test from 'node:test';
import assert from 'node:assert/strict';
import {planTokenReturn} from '../src/token-earn-policy.mjs';
test('a still-valid quoted return amount keeps its measured reserve and fee checks',async()=>{
 const p=await planTokenReturn({balance:2705275n,initialAmount:2650000n,price:1000300n,estimate:async amount=>{assert.equal(amount,2650000n);return {feeCap:30000n};}});
 assert.equal(p.amount,2650000n);assert.equal(p.reserve,55275n);assert.equal(p.optimalUpperBound,true);
 await assert.rejects(planTokenReturn({balance:1000000n,initialAmount:1000001n,price:1000000n,estimate:()=>assert.fail('invalid amount estimated')}),/quoted return amount/i);
});
