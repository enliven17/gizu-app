import test from 'node:test';
import assert from 'node:assert/strict';
import {gasBudget,requireNativeFunding,depositAmount,assertBootstrapSettlement,assertFreshQuote,selectBootstrapQuote,nativeFeeQuote,planNativeFunding} from '../src/native-gas.mjs';

test('fee quote follows the reference block, with explicit separate withdrawal headroom',()=>{
 const block={number:10n,baseFeePerGas:800n,gasLimit:200n,gasUsed:100n};
 const q=nativeFeeQuote({block,priorityFee:200n,depositBlocks:2,withdrawFeeBps:15000n});
 assert.equal(q.depositFee,1100n); // next 800, following worst-case 900, plus tip 200
 assert.equal(q.withdrawFee,1650n);
 assert.equal(q.blockNumber,10n);
 assert.throws(()=>nativeFeeQuote({block,priorityFee:200n,withdrawFeeBps:9999n}),/withdrawal/);
});

test('budget follows measured gas and separates future withdrawal reserve',()=>{
 const q=gasBudget({depositGas:[50000n,300000n],withdrawGas:[45000n,200000n],depositFee:1000000000n,withdrawFee:2000000000n,depositMarginBps:1000n,withdrawMarginBps:3000n});
 assert.deepEqual(q.depositLimits,[55000n,330000n]);
 assert.equal(q.depositWei,385000000000000n);
 assert.equal(q.withdrawWei,637000000000000n);
 assert.equal(q.totalWei,1022000000000000n);
 const changed=gasBudget({depositGas:[50000n,600000n],withdrawGas:[45000n,200000n],depositFee:1000000000n,withdrawFee:2000000000n,depositMarginBps:1000n,withdrawMarginBps:3000n});
 assert.equal(changed.totalWei-q.totalWei,330000000000000n);
});
test('ceil margins never underfund fractional gas and reject invalid estimates',()=>{
 assert.equal(gasBudget({depositGas:[1n],withdrawGas:[1n],depositFee:1n,withdrawFee:1n,depositMarginBps:1n,withdrawMarginBps:2n}).totalWei,4n);
 assert.throws(()=>gasBudget({depositGas:[0n],withdrawGas:[1n],depositFee:1n,withdrawFee:1n}),/gas/i);
});
test('increased market fees fail the affordability gate without reducing the fee bid',()=>{
 assert.equal(requireNativeFunding({balance:120n,gasLimit:10n,maxFeePerGas:7n,reserve:50n}),0n);
 assert.throws(()=>requireNativeFunding({balance:120n,gasLimit:10n,maxFeePerGas:8n,reserve:50n}),/shortfall.*10/);
});
test('deposit uses settled USDC balance and leaves the selected strict residual',()=>{
 assert.equal(depositAmount(3000001n,50000n),2950001n);
 assert.throws(()=>depositAmount(1000000n,500000n),/residual/i);
 assert.throws(()=>depositAmount(49999n,50000n),/balance/i);
});
test('bootstrap requires full exact input debit and sufficient native ETH, not WETH',()=>{
 const settled={beforeUsdc:5000000n,afterUsdc:4000000n,soldUsdc:1000000n,beforeEth:0n,afterEth:100n,minimumEth:100n};
 assert.doesNotThrow(()=>assertBootstrapSettlement(settled));
 assert.throws(()=>assertBootstrapSettlement({...settled,afterEth:0n}),/native ETH/);
 assert.throws(()=>assertBootstrapSettlement({...settled,afterUsdc:4500000n}),/full/);
});
test('stale state and expired quotes cannot authorize an execution',()=>{
 assert.doesNotThrow(()=>assertFreshQuote({quotedBlock:10n,currentBlock:10n,deadline:101n,now:100n}));
 assert.throws(()=>assertFreshQuote({quotedBlock:10n,currentBlock:11n,deadline:101n,now:100n}),/stale/);
 assert.throws(()=>assertFreshQuote({quotedBlock:10n,currentBlock:10n,deadline:100n,now:100n}),/expired/);
});
test('bootstrap sizes against guaranteed net native output, refusing uneconomic or unfillable quotes',async()=>{
 const quote=await selectBootstrapQuote({requiredEth:100n,maxInput:1000n,initialInput:50n,quote:async amount=>({input:amount,minimumEth:amount/2n})});
 assert(quote.minimumEth>=100n); assert(quote.input<=1000n);
 await assert.rejects(()=>selectBootstrapQuote({requiredEth:100n,maxInput:100n,initialInput:50n,quote:async amount=>({input:amount,minimumEth:amount/2n})}),/insufficient|afford/i);
 await assert.rejects(()=>selectBootstrapQuote({requiredEth:100n,maxInput:1000n,initialInput:50n,quote:async amount=>({input:amount,minimumEth:0n})}),/output/i);
});
test('re-quotes ETH when the final deposit amount changes the withdrawal gas path',async()=>{
 const plan=await planNativeFunding({balance:1000000n,residual:50000n,
  simulate:async amount=>({budget:{totalWei:amount===950000n?100n:150n}}),
  quote:async required=>({input:required*100n,minimumEth:required}),
 });
 assert.equal(plan.requiredEth,150n);
 assert.equal(plan.quote.input,15000n);
 assert.equal(plan.amount,935000n);
});

test('small-order rejection increases size within budget, without hiding other provider failures',async()=>{
 const calls=[];
 const result=await selectBootstrapQuote({requiredEth:10n,maxInput:1000n,initialInput:20n,quote:async input=>{
  calls.push(input);
  if(input<100n)throw Object.assign(new Error('insufficient amount'),{code:'FUSION_AMOUNT_TOO_SMALL'});
  return {input,minimumEth:input/10n};
 }});
 assert(result.input>=100n);assert(result.input<=1000n);assert(calls.length>1);
 await assert.rejects(()=>selectBootstrapQuote({requiredEth:10n,maxInput:50n,initialInput:20n,quote:async()=>{throw Object.assign(new Error('insufficient amount'),{code:'FUSION_AMOUNT_TOO_SMALL'});}}),/affordable/);
 await assert.rejects(()=>selectBootstrapQuote({requiredEth:10n,maxInput:1000n,initialInput:20n,quote:async()=>{throw new Error('HTTP 401');}}),/401/);
});
