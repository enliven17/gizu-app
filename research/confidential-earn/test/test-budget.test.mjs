import test from 'node:test';
import assert from 'node:assert/strict';
import {createTestBudget,allocatedBudget} from '../src/test-budget.mjs';
const source='0x1111111111111111111111111111111111111111',token='0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
test('70/30 allocation conserves every atom and stays fixed after first test spends',()=>{
 const plan=createTestBudget({balance:11000001n,source,token,block:42n});
 assert.equal(allocatedBudget(plan,{route:'ethereum',source,token,balance:11000001n}),7700000n);
 assert.equal(allocatedBudget(plan,{route:'robinhood',source,token,balance:3301001n}),3300001n);
 assert.equal(BigInt(plan.allocations.ethereum)+BigInt(plan.allocations.robinhood),11000001n);
});
test('allocation fails closed for changed source, insufficient balance or excessive per-test budget',()=>{
 const plan=createTestBudget({balance:10000000n,source,token,block:42n});
 assert.throws(()=>allocatedBudget(plan,{route:'ethereum',source:'changed',token,balance:10000000n}),/source/);
 assert.throws(()=>allocatedBudget(plan,{route:'robinhood',source,token,balance:2999999n}),/balance/);
 assert.throws(()=>createTestBudget({balance:20000000n,source,token,block:42n}),/10 USDC/);
});
