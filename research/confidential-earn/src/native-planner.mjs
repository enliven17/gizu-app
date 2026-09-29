import {nativeFeeQuote,ceilDiv,depositAmount,selectBootstrapQuote,requireNativeFunding,nativeSweepPlan} from './native-gas.mjs';
import {priorityFromFeeHistory,nextBlockBaseFee} from './ethereum-fee.mjs';
import {depositCalls,redeemCalls,auroraTransfer} from './native-vault.mjs';
import {formatEther,formatUnits,formatGwei} from 'viem';
export function assertNativeMarket(fees,block){
 if(block.number>fees.block.number+1n)throw new Error('Native plan is stale; re-plan');
 if(nextBlockBaseFee(block)+fees.priorityFee>fees.depositFee)throw new Error('Market fee exceeded planned cap; re-plan');
}
export async function marketFees(client,{replace}={}) {
 const block=await client.getBlock();
 // Target cheaper included transactions; the full median smooths eight blocks.
 const history=await client.getFeeHistory({blockCount:8,blockNumber:block.number,rewardPercentiles:[25]});
 const medianPriorityFee=priorityFromFeeHistory(history);
 let priority=medianPriorityFee;
 if(replace?.request.maxPriorityFeePerGas)priority=priority>ceilDiv(replace.request.maxPriorityFeePerGas*1125n,1000n)?priority:ceilDiv(replace.request.maxPriorityFeePerGas*1125n,1000n);
 const fees=nativeFeeQuote({block,priorityFee:priority});
 const previous=replace?.request.gasPrice??replace?.request.maxFeePerGas;
 if(previous){const floor=ceilDiv(previous*1125n,1000n);if(fees.depositFee<floor)fees.depositFee=floor;fees.withdrawFee=fees.depositFee*2n;}
 return {...fees,medianPriorityFee,block};
}
function depositSummary({balances,simulation,price,amount,funding,canDeposit=true}) {
 const budget=simulation.budget;
 const summary={canDeposit,initialUSDC:formatUnits(balances.usdc,6),existingETH:formatEther(balances.eth),gasBudgetETH:formatEther(budget.totalWei),gasBudgetUSDC:formatUnits(ceilDiv(budget.totalWei*price,10n**18n),6),fusionInputUSDC:canDeposit?formatUnits(funding?.input??0n,6):null,depositUSDC:formatUnits(amount,6),retainedUSDC:canDeposit?formatUnits(balances.usdc-(funding?.input??0n)-amount,6):null};
 const e=funding?.economics;
 if(e)Object.assign(summary,{resolverAllowanceETH:formatEther(e.allowanceWei),resolverAllowanceUSDC:formatUnits(ceilDiv(e.allowanceWei*price,10n**18n),6),resolverBudgetGwei:formatGwei(e.gasPrice),resolverBreakEvenGwei:formatGwei(e.breakEvenGasPrice)});
 const received=funding?.minimumEth??0n;
 const purchaseValue=ceilDiv((funding?.input??0n)*10n**18n,price);
 // The quote's input-minus-net-output value includes all swap costs: resolver
 // execution/profit, protocol fee and price headroom. Do not add allowance again.
 const overhead=purchaseValue>received?purchaseValue-received:0n;
 const extra=funding&&balances.eth+received>budget.totalWei?balances.eth+received-budget.totalWei:0n;
 Object.assign(summary,{depositGasBudgetETH:budget.depositWei===undefined?null:formatEther(budget.depositWei),withdrawalGasReserveETH:budget.withdrawWei===undefined?null:formatEther(budget.withdrawWei),minimumETHReceived:canDeposit?formatEther(received):null,fusionOverheadETH:canDeposit?formatEther(overhead):null,fusionOverheadUSDC:canDeposit?formatUnits(ceilDiv(overhead*price,10n**18n),6):null,totalBudgetETH:canDeposit?formatEther(budget.totalWei+overhead):null,totalBudgetUSDC:canDeposit?formatUnits(ceilDiv((budget.totalWei+overhead)*price,10n**18n),6):null,extraPurchasedETH:canDeposit?formatEther(extra):null});
 summary.message=(canDeposit?`Estimated Ethereum fee budget, including Fusion costs and the deposit + withdrawal gas reserves, is ${summary.totalBudgetETH} ETH equivalent (approximately ${summary.totalBudgetUSDC} USDC). `:`The deposit + withdrawal gas reserve alone is ${summary.gasBudgetETH} ETH (approximately ${summary.gasBudgetUSDC} USDC). `)+`From your initial wallet balance of ${summary.initialUSDC} USDC, ${summary.depositUSDC} USDC can be deposited into the vault. `+(canDeposit?`The Fusion ETH purchase uses ${summary.fusionInputUSDC} USDC; ${summary.retainedUSDC} USDC stays liquid. Fusion costs include resolver execution, profit allowance, provider fees and price headroom. These costs are already inside the quoted purchase amount. ${summary.extraPurchasedETH} ETH of additional funding headroom is included in that purchase, not counted as a fee. `:'The balance cannot cover the gas reserve at the available Fusion quote. ')+`This is a budget, not an exact final charge; unused ETH remains available for the return. Aurora return fees are excluded and re-quoted after withdrawal.`;
 return summary;
}
export async function planDeposit({balances,simulate,quote,price,initialShares=0n}) {
 if(balances.shares!==initialShares||initialShares<0n)throw new Error('Existing share baseline changed before deposit');
 let selected=null,amount=depositAmount(balances.usdc);
 for(let i=0;i<5;i++) {
  const simulation=await simulate({amount,initialShares});
  const shortfall=simulation.budget.totalWei-balances.eth;
  if(shortfall<=0n&&!selected)return {amount,simulation,summary:depositSummary({balances,simulation,price,amount})};
  if(selected&&balances.eth+selected.minimumEth>=simulation.budget.totalWei){
   const funding={input:selected.input,minimumEth:selected.minimumEth,requiredEth:shortfall,before:balances,economics:selected.economics};
   return {amount,simulation,funding,summary:depositSummary({balances,simulation,price,amount,funding})};
  }
  try{selected=await selectBootstrapQuote({requiredEth:shortfall,maxInput:balances.usdc-50001n,initialInput:ceilDiv(shortfall*price,10n**18n),quote});}
  catch(error){if(error.code==='FUSION_UNAFFORDABLE')error.summary=depositSummary({balances,simulation,price,amount:0n,canDeposit:false});throw error;}
  amount=depositAmount(balances.usdc-selected.input);
 }
 throw new Error('Native deposit funding did not stabilize');
}
export async function prepareNativeStep(action,state,c,{replace,preview=false}={}) {
 const balances=await c.balances(),fees=await c.fees({replace});
 if(balances.weth!==0n)throw new Error('Unexpected WETH balance; native ETH is required and WETH must be reconciled');
 const deadline=fees.block.timestamp+600n;
 const nonce=replace?.nonce??await c.latestNonce();
 const simulate=options=>c.simulate({...options,block:fees.block,fees});
 let kind,call,route,reserve=0n,margin=1000n,details={};
 if(action==='deposit') {
  if(state.phase==='invested')return {done:true,phase:'invested'};
  let plan;
  try{plan=await planDeposit({balances,simulate,quote:input=>c.quoteFusion(input,{fees}),price:await c.price(),initialShares:state.initialShares??0n});}
  catch(error){if(error.summary)error.fees=fees;throw error;}
  if(plan.funding){if(replace)throw new Error('Replacement ETH budget insufficient; pending operation must be resolved');await c.assertFresh(fees,balances);return {...plan,funding:{...plan.funding,fees},fees,before:balances};}
  const prepared=await depositCalls({client:c.client,owner:c.owner,amount:plan.amount,deadline});
  kind=prepared.calls.length>1?'approve_deposit':'deposit';call=prepared.calls[0];reserve=plan.simulation.budget.withdrawWei;details={amount:plan.amount,reserve,simulation:plan.simulation,summary:plan.summary};
 } else if(action==='withdraw') {
  if(balances.shares===0n)return {done:true,phase:'withdrawn'};
  const simulation=await simulate({shares:balances.shares});
  if(balances.eth<simulation.withdrawalMaximum)throw new Error('ETH withdrawal reserve insufficient at current fees; no approval sent');
  const prepared=await redeemCalls({client:c.client,owner:c.owner,shares:balances.shares,deadline});
  kind=prepared.calls.length>1?'approve_withdraw':'withdraw';call=prepared.calls[0];margin=3000n;details={shares:balances.shares,simulation};
 } else if(action==='return') {
  if(balances.shares!==0n)throw new Error('Redeem all vault shares before returning funds');
  if(state.phase==='return_eth'||(balances.usdc===0n&&state.routes.some(r=>r.kind==='usdc'))) {
   const initial=nativeSweepPlan({balance:balances.eth,gasPrice:fees.depositFee,estimatedGas:21000n,recipientCode:'0x'});
   route=await c.quoteReturn('eth',initial.value);
   await c.validateRecipient(route.recipient,true);
   call={to:route.recipient,value:initial.value,data:'0x'};
   const estimatedGas=await c.client.estimateGas({account:c.owner,...call,gasPrice:fees.depositFee,stateOverride:[{address:c.owner,balance:10n**22n}]});
   const sweep=nativeSweepPlan({balance:balances.eth,gasPrice:fees.depositFee,estimatedGas,recipientCode:await c.client.getCode({address:route.recipient})});
   await c.assertFresh(fees,balances);
   return {kind:'return_eth',route,before:balances,fees,request:{...call,...sweep,nonce,chainId:1},details:{estimatedGas}};
  }
  if(balances.usdc<=0n)throw new Error('No USDC return exists for this cycle; reconcile state');
  route=await c.quoteReturn('usdc',balances.usdc);await c.validateRecipient(route.recipient,false);
  call=auroraTransfer({recipient:route.recipient,amount:balances.usdc});
  const estimated=await c.client.estimateGas({account:c.owner,...call,maxFeePerGas:fees.depositFee,maxPriorityFeePerGas:fees.priorityFee,stateOverride:[{address:c.owner,balance:10n**22n}]});
  const usdcCost=ceilDiv(estimated*110n,100n)*fees.depositFee,cleanupFee=21000n*fees.depositFee;
  const lower=balances.eth-usdcCost-cleanupFee;
  const candidate=lower>0n?lower:cleanupFee;
  const nativePreview=await c.quoteReturn('eth',candidate);await c.validateRecipient(nativePreview.recipient,true);
  const shortfall=usdcCost+cleanupFee+candidate-balances.eth;
  if(shortfall>0n) {
   if(replace)throw new Error('Replacement cannot buy ETH while a return transaction is pending');
   const q=await selectBootstrapQuote({requiredEth:shortfall,maxInput:balances.usdc-1n,initialInput:ceilDiv(shortfall*(await c.price()),10n**18n),quote:input=>c.quoteFusion(input,{fees})});
   // Both resulting return amounts must be quoted before purchasing ETH.
   await c.quoteReturn('usdc',balances.usdc-q.input);
   await c.assertFresh(fees,balances);return {funding:{input:q.input,requiredEth:shortfall,before:balances,fees,economics:q.economics},fees,before:balances};
  }
  kind='return_usdc';details={amount:balances.usdc,nativePreviewMinimum:nativePreview.minimumOut};reserve=cleanupFee+candidate;
 } else throw new Error('Unknown native action');
 const estimatedGas=await c.client.estimateGas({account:c.owner,...call,maxFeePerGas:fees.depositFee,maxPriorityFeePerGas:fees.priorityFee,stateOverride:[{address:c.owner,balance:10n**22n}]});
 const gas=ceilDiv(estimatedGas*(10000n+margin),10000n);
 requireNativeFunding({balance:balances.eth,gasLimit:gas,maxFeePerGas:fees.depositFee,reserve});
 await c.assertFresh(fees,balances);
 return {kind,route,before:balances,fees,summary:details.summary,details:{...details,estimatedGas},request:{...call,gas,maxFeePerGas:fees.depositFee,maxPriorityFeePerGas:fees.priorityFee,nonce,chainId:1,type:'eip1559'}};
}
