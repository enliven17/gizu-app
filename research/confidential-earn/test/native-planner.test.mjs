import test from 'node:test';
import assert from 'node:assert/strict';
import {planDeposit,marketFees} from '../src/native-planner.mjs';
test('native bidding selects the approved 25th-percentile full median instead of the cheaper or faster samples',async()=>{
 const samples={10:[999999n,50000000n,10000000n,50000001n,86273833n,50000000n,200153000n,76500n],25:[150000000n,288617840n,200000000n,215664992n,215300759n,302935290n,1074573912n,71401234n],40:[470000000n,1000000000n,500000000n,1000000000n,1000000000n,1000000000n,1235697607n,200000000n]};
 const client={getBlock:async()=>({number:26085239n,baseFeePerGas:800000000n,gasUsed:100n,gasLimit:200n}),getFeeHistory:async({rewardPercentiles})=>({reward:samples[rewardPercentiles[0]].map(tip=>[tip])})};
 const fees=await marketFees(client);
 assert.equal(fees.medianPriorityFee,215664992n);
 assert.equal(fees.priorityFee,215664992n);
 assert.equal(fees.depositFee,1115664992n);
 assert.equal(fees.withdrawFee,2231329984n);
});
test('native fees use the full sampled median without weakening replacement requirements',async()=>{
 const client={getBlock:async()=>({number:1n,baseFeePerGas:1000000000n,gasUsed:100n,gasLimit:200n}),getFeeHistory:async()=>({reward:[[360000000n],[300000000n],[400000000n],[360000000n],[360000000n],[360000000n],[300000000n],[400000000n]]})};
 const fees=await marketFees(client);
 assert.equal(fees.medianPriorityFee,360000000n);
 assert.equal(fees.priorityFee,360000000n);
 assert.equal(fees.depositFee,1485000000n);
 assert.equal(fees.withdrawFee,2970000000n);
 const replacement=await marketFees(client,{replace:{request:{maxPriorityFeePerGas:360000000n,maxFeePerGas:1500000000n}}});
 assert.equal(replacement.priorityFee,405000000n);
 assert.equal(replacement.depositFee,1687500000n);
});
test('deposit disclosure reconciles the initial balance, Fusion purchase and spendable vault amount',async()=>{
 const p=await planDeposit({balances:{usdc:10000000n,eth:0n,shares:0n},simulate:async()=>({budget:{totalWei:1000000000000000n,depositWei:400000000000000n,withdrawWei:600000000000000n}}),quote:async input=>({input,minimumEth:input*1000000000n}),price:2000000000n});
 assert.equal(p.summary.gasBudgetETH,'0.001');assert.equal(p.summary.gasBudgetUSDC,'2');
 assert.equal(p.summary.fusionInputUSDC,'2');assert.equal(p.summary.initialUSDC,'10');
 assert.equal(p.summary.depositUSDC,'7.95');assert.equal(p.summary.retainedUSDC,'0.05');
 assert.match(p.summary.message,/From your initial wallet balance of 10 USDC, 7.95 USDC can be deposited/);
 assert.match(p.summary.message,/Aurora return fees.*re-quoted/);
 const funded=await planDeposit({balances:{usdc:10000000n,eth:1000000000000000n,shares:0n},simulate:async()=>({budget:{totalWei:1000000000000000n}}),quote:()=>assert.fail('already funded'),price:2000000000n});
 assert.equal(funded.summary.fusionInputUSDC,'0');assert.equal(funded.summary.depositUSDC,'9.95');
});
test('unaffordable gas exposes a zero investable amount and preserves the rejection',async()=>{
 await assert.rejects(planDeposit({balances:{usdc:1000000n,eth:0n,shares:0n},simulate:async()=>({budget:{totalWei:1000000000000000n}}),quote:async input=>({input,minimumEth:input*1000000000n}),price:2000000000n}),error=>{
  assert.equal(error.code,'FUSION_UNAFFORDABLE');assert.equal(error.summary.depositUSDC,'0');assert.equal(error.summary.canDeposit,false);
  assert.equal(error.summary.gasBudgetUSDC,'2');assert.match(error.summary.message,/cannot cover/);return true;
 });
});
test('existing ETH is credited before buying gas; adequately funded wallet makes no Fusion request',async()=>{
 const p=await planDeposit({balances:{usdc:1000000n,eth:200n,shares:0n},simulate:async()=>({budget:{totalWei:100n}}),quote:()=>assert.fail('unnecessary order'),price:10n**18n});
 assert.equal(p.amount,950000n);assert.equal(p.funding,undefined);
});
test('only the measured ETH shortfall is purchased and amount-dependent gas is checked again',async()=>{
 const p=await planDeposit({balances:{usdc:1000000n,eth:40n,shares:0n},simulate:async({amount})=>({budget:{totalWei:amount===950000n?100n:120n}}),quote:async input=>({input,minimumEth:input}),price:10n**18n});
 assert(p.funding.requiredEth>=80n);assert(p.funding.input>=80n);assert.equal(p.amount,950000n-p.funding.input);
});
test('next-block inclusion check allows a falling base fee and rejects an actual fee shortfall',async()=>{
 const {assertNativeMarket}=await import('../src/native-planner.mjs');
 const block={number:1n,baseFeePerGas:800n,gasUsed:0n,gasLimit:200n};
 assert.doesNotThrow(()=>assertNativeMarket({block,priorityFee:1n,depositFee:788n},block));
 assert.throws(()=>assertNativeMarket({block,priorityFee:1n,depositFee:700n},block),/fee/);
});
test('a funding plan carries its reference fees and rejects stale state before authorizing an order',async()=>{
 const {prepareNativeStep}=await import('../src/native-planner.mjs');
 const balances={usdc:1000000n,eth:0n,shares:0n,weth:0n};const fees={block:{number:1n,timestamp:10n},depositFee:1n,withdrawFee:2n};
 let checked=false;
 const c={balances:async()=>balances,fees:async()=>fees,latestNonce:async()=>0,simulate:async()=>({budget:{totalWei:100n}}),price:async()=>10n**18n,quoteFusion:async input=>({input,minimumEth:input}),assertFresh:async(f,b)=>{checked=true;assert.equal(f,fees);assert.equal(b,balances);}};
 const plan=await prepareNativeStep('deposit',{},c);assert(checked);assert.equal(plan.funding.fees,fees);
 c.assertFresh=async()=>{throw new Error('stale funding reference');};await assert.rejects(()=>prepareNativeStep('deposit',{},c),/stale funding/);
});
test('a recorded initial share balance is included in simulation, and a different balance is rejected',async()=>{
 let received;
 const args={balances:{usdc:1000000n,eth:200n,shares:7n},initialShares:7n,simulate:async options=>{received=options;return {budget:{totalWei:100n}};},quote:()=>assert.fail('unnecessary order'),price:10n**18n};
 const p=await planDeposit(args);assert.equal(p.amount,950000n);assert.equal(received.initialShares,7n);
 await assert.rejects(planDeposit({...args,initialShares:6n}),/shares.*changed|share.*baseline/i);
 await assert.rejects(planDeposit({...args,initialShares:undefined}),/shares|share/i);
});
test('deposit and return funding quotes receive the live fee cap and preserve resolver economics for signing',async()=>{
 const {prepareNativeStep}=await import('../src/native-planner.mjs');
 const fees={block:{number:1n,timestamp:10n},depositFee:800000000n,withdrawFee:1600000000n};
 const economics={estimatedGas:300000n,gasCostWei:100n,profitWei:10n,allowanceWei:110n,gasPrice:1000000000n,breakEvenGasPrice:1100000000n};
 const c={balances:async()=>({usdc:1000000n,eth:0n,shares:0n,weth:0n}),fees:async()=>fees,latestNonce:async()=>0,simulate:async()=>({budget:{totalWei:100n}}),price:async()=>10n**18n,quoteFusion:async(input,options)=>{assert.equal(options?.fees,fees);return {input,minimumEth:input,economics};},assertFresh:async()=>{}};
 const plan=await prepareNativeStep('deposit',{},c);
 assert.equal(plan.funding.economics,economics);
 assert.equal(plan.summary.resolverAllowanceETH,'0.00000000000000011');
 c.quoteReturn=async()=>({recipient:'0x1111111111111111111111111111111111111111',minimumOut:1n});c.validateRecipient=async()=>{};
 c.client={estimateGas:async()=>50000n};c.price=async()=>2500000000n;
 c.quoteFusion=async(input,options)=>{assert.equal(options?.fees,fees);return {input,minimumEth:input*1000000000n,economics};};
 const returning=await prepareNativeStep('return',{phase:'withdrawn',routes:[]},c);
 assert.equal(returning.funding.economics,economics);
});
test('combined disclosure counts Fusion overhead once and separates purchased ETH headroom from fees',async()=>{
 const p=await planDeposit({balances:{usdc:10000000n,eth:0n,shares:0n},simulate:async()=>({budget:{totalWei:1000000000000000n,depositWei:400000000000000n,withdrawWei:600000000000000n}}),quote:async input=>({input,minimumEth:input*400000000n}),price:2000000000n});
 // Selector buys 2.525 USDC, receives .00101 ETH ($2.02).
 // Swap overhead = .505 USDC; native reserve = $2; combined = $2.505.
 assert.equal(p.summary.fusionInputUSDC,'2.525');
 assert.equal(p.summary.minimumETHReceived,'0.00101');
 assert.equal(p.summary.fusionOverheadETH,'0.0002525');
 assert.equal(p.summary.totalBudgetETH,'0.0012525');
 assert.equal(p.summary.totalBudgetUSDC,'2.505');
 assert.equal(p.summary.extraPurchasedETH,'0.00001');
 assert.equal(p.summary.depositGasBudgetETH,'0.0004');
 assert.equal(p.summary.withdrawalGasReserveETH,'0.0006');
 assert.equal(p.summary.depositUSDC,'7.425');assert.equal(p.summary.retainedUSDC,'0.05');
 assert.match(p.summary.message,/including Fusion/);
});
