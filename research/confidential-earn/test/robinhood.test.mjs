import test from 'node:test';
import assert from 'node:assert/strict';
import {planTokenDeposit,planTokenReturn,tokenCostCap,assertFinalResidual} from '../src/token-earn-policy.mjs';
test('deposit reserves full deposit cap and stress-priced withdrawal cap',async()=>{
 const p=await planTokenDeposit({balance:10000000n,estimate:async amount=>({amount,feeCap:100000n,withdrawalReserve:300000n})});
 assert.equal(p.amount,9600000n);assert.equal(p.withdrawalReserve,300000n);
});
test('deposit iterates when gas cost increases and rejects unaffordable withdrawal',async()=>{
 const p=await planTokenDeposit({balance:1000000n,estimate:async amount=>({amount,feeCap:amount>800000n?10000n:20000n,withdrawalReserve:250000n})});
 assert.equal(p.amount,730000n);
 await assert.rejects(planTokenDeposit({balance:10n,estimate:async()=>({feeCap:5n,withdrawalReserve:8n})}),/Insufficient/);
});
test('return uses current whole balance; rejects residual at threshold without lowering fee',async()=>{
 const p=await planTokenReturn({balance:1000000n,estimate:async amount=>({amount,feeCap:90000n}),price:1000000n});assert.equal(p.amount,910000n);
 await assert.rejects(planTokenReturn({balance:1000000n,estimate:async()=>({feeCap:500000n}),price:1000000n}),/residual/);
});
test('combined final residual counts native ETH and USDG valuation',()=>{
 assert.equal(assertFinalResidual({token:90000n,native:0n,tokenPrice:1000000n,nativePrice:3000000000n}).optimal,true);
 assert.throws(()=>assertFinalResidual({token:0n,native:10n**15n,tokenPrice:1000000n,nativePrice:3000000000n}),/residual/);
});
test('fee caps reject unsupported extra fee/recipient modes',()=>{
 const op={paymasterData:'0x0301'+'00'.repeat(180)};assert.throws(()=>tokenCostCap(op,'0x0000000000000000000000000000000000000001'),/configuration/);
});
test('return budgets unsolicited native dust without preventing withdrawal',async()=>{
 const estimate=async()=>({feeCap:90000n});
 const p=await planTokenReturn({balance:1000000n,estimate,price:1000000n,nativeValue:1n});assert.equal(p.optimalUpperBound,true);
 await assert.rejects(planTokenReturn({balance:1000000n,estimate,price:1000000n,nativeValue:410000n}),/residual/);
});
