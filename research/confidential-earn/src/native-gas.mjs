// Native gas budgets contain integer wei and measured gas, never fixed USDC fees.
import {nextBlockBaseFee} from './ethereum-fee.mjs';
export async function planNativeFunding({balance,residual=50000n,simulate,quote}) {
 let simulation=await simulate(depositAmount(balance,residual));
 let requiredEth=simulation.budget.totalWei;
 for(let attempt=0;attempt<5;attempt++) {
  const selected=await quote(requiredEth,balance-residual-1n);
  uint(selected.input,'Fusion input',true);uint(selected.minimumEth,'minimum ETH',true);
  if(selected.minimumEth<requiredEth)throw new Error('Insufficient Fusion minimum output');
  const amount=depositAmount(balance-selected.input,residual);
  simulation=await simulate(amount);
  if(simulation.budget.totalWei<=selected.minimumEth)return {quote:selected,amount,simulation,requiredEth:simulation.budget.totalWei};
  requiredEth=simulation.budget.totalWei>requiredEth?simulation.budget.totalWei:requiredEth;
 }
 throw new Error('Deposit/withdrawal funding did not stabilize');
}
export function nativeFeeQuote({block,priorityFee,depositBlocks=2,withdrawFeeBps=20000n}) {
 uint(priorityFee,'priority fee',true);uint(withdrawFeeBps,'withdrawal fee margin');
 if(withdrawFeeBps<10000n||withdrawFeeBps>100000n)throw new Error('Invalid withdrawal fee margin');
 if(!Number.isInteger(depositBlocks)||depositBlocks<1||depositBlocks>20)throw new Error('Invalid deposit inclusion horizon');
 let maximumBase=nextBlockBaseFee(block);
 for(let i=1;i<depositBlocks;i++)maximumBase+=maximumBase/8n>0n?maximumBase/8n:1n;
 const depositFee=maximumBase+priorityFee;
 return {blockNumber:block.number,depositFee,priorityFee,withdrawFee:ceilDiv(depositFee*withdrawFeeBps,10000n),depositBlocks,withdrawFeeBps};
}
export const ceilDiv=(a,b)=>(a+b-1n)/b;
function uint(value,name,positive=false) {
 if(typeof value!=='bigint'||value<0n||(positive&&value===0n))throw new Error(`Invalid ${name}`);
}
export function gasBudget({depositGas,withdrawGas,depositFee,withdrawFee,depositMarginBps=1000n,withdrawMarginBps=3000n}) {
 for(const [name,value] of Object.entries({depositFee,withdrawFee}))uint(value,name,true);
 for(const value of [depositMarginBps,withdrawMarginBps]){uint(value,'gas margin');if(value>10000n)throw new Error('Gas margin exceeds 100%');}
 const limits=(values,margin)=>{
  if(!Array.isArray(values)||!values.length)throw new Error('Missing gas estimates');
  return values.map(gas=>{uint(gas,'gas estimate',true);return ceilDiv(gas*(10000n+margin),10000n);});
 };
 const depositLimits=limits(depositGas,depositMarginBps),withdrawLimits=limits(withdrawGas,withdrawMarginBps);
 const depositWei=depositLimits.reduce((a,b)=>a+b,0n)*depositFee;
 const withdrawWei=withdrawLimits.reduce((a,b)=>a+b,0n)*withdrawFee;
 return {depositLimits,withdrawLimits,depositWei,withdrawWei,totalWei:depositWei+withdrawWei,depositFee,withdrawFee,depositMarginBps,withdrawMarginBps};
}
export function requireNativeFunding({balance,gasLimit,maxFeePerGas,reserve=0n}) {
 uint(balance,'ETH balance');uint(gasLimit,'gas limit',true);uint(maxFeePerGas,'fee cap',true);uint(reserve,'reserve');
 const left=balance-gasLimit*maxFeePerGas-reserve;
 if(left<0n)throw new Error(`Native ETH shortfall: ${-left} wei; re-quote funding before execution`);
 return left;
}
export function depositAmount(balance,residual=50000n) {
 uint(balance,'USDC balance');uint(residual,'residual');
 if(residual>=500000n)throw new Error('Residual must be strictly below 0.5 USDC');
 if(balance<=residual)throw new Error('Insufficient USDC balance after gas purchase');
 return balance-residual;
}
export function assertBootstrapSettlement({beforeUsdc,afterUsdc,soldUsdc,beforeEth,afterEth,minimumEth}) {
 for(const value of [beforeUsdc,afterUsdc,beforeEth,afterEth])uint(value,'settlement balance');
 uint(soldUsdc,'USDC input',true);uint(minimumEth,'minimum ETH',true);
 if(beforeUsdc-afterUsdc!==soldUsdc)throw new Error('Fusion full input was not settled; do not deposit');
 if(afterEth-beforeEth<minimumEth)throw new Error('Insufficient native ETH received; WETH is not gas');
}
export function assertFreshQuote({quotedBlock,currentBlock,deadline,now}) {
 for(const value of [quotedBlock,currentBlock,deadline,now])uint(value,'quote state');
 if(currentBlock!==quotedBlock)throw new Error('Gas quote is stale; re-estimate on current state');
 if(now>=deadline)throw new Error('Quote expired; do not sign');
}
// Provider minimum output must be net of fees, valid for the whole auction,
// native ETH, and for a full fill. This never substitutes a spot-price guess.
export async function selectBootstrapQuote({requiredEth,maxInput,initialInput,quote}) {
 for(const [name,value] of Object.entries({requiredEth,maxInput,initialInput}))uint(value,name,true);
 let input=initialInput<maxInput?initialInput:maxInput;
 for(let i=0;i<8;i++) {
  let result;
  try {result=await quote(input);} catch(error) {
   if(error.code!=='FUSION_AMOUNT_TOO_SMALL')throw error;
   if(input===maxInput)throw Object.assign(new Error('Insufficient affordable Fusion output'),{code:'FUSION_UNAFFORDABLE'});
   input=input*2n>maxInput?maxInput:input*2n;
   continue;
  }
  if(result.input!==input)throw new Error('Quote input differs from request');
  uint(result.minimumEth,'quote native output',true);
  if(result.minimumEth>=requiredEth)return result;
  if(input===maxInput)throw Object.assign(new Error('Insufficient affordable Fusion output'),{code:'FUSION_UNAFFORDABLE'});
  // Resolver execution is largely fixed overhead. Add the missing ETH's spot
  // value rather than multiplying that overhead by the output-shortfall ratio.
  const next=result.economics?.inputValueWei>0n
   ?ceilDiv((input+ceilDiv((requiredEth-result.minimumEth)*input,result.economics.inputValueWei))*101n,100n)
   :ceilDiv(input*requiredEth*101n,result.minimumEth*100n);
  input=next>maxInput?maxInput:next;
 }
 throw new Error('Fusion funding quote did not converge');
}

// Completion is measured after the return, in both spendable assets.
export function assertCycleComplete({usdc,eth,shares,ethPriceUsdc}) {
 for(const value of [usdc,eth,shares])uint(value,'cycle balance');
 uint(ethPriceUsdc,'ETH price in USDC atoms',true);
 if(shares!==0n)throw new Error('Vault shares remain; cycle is not complete');
 const totalUsdcAtoms=usdc+ceilDiv(eth*ethPriceUsdc,10n**18n);
 if(totalUsdcAtoms>=500000n)throw new Error(`Combined ETH + USDC residual exceeds acceptance: ${totalUsdcAtoms} USDC atoms`);
 return {totalUsdcAtoms,optimal:totalUsdcAtoms<100000n};
}
// A legacy transaction's gasPrice is the actual inclusion price, not an
// EIP-1559 maximum that can later refund a difference. This plan is restricted
// to an empty-code recipient and an empty-data, 21,000-gas native transfer.
export function nativeSweepPlan({balance,gasPrice,estimatedGas,recipientCode}) {
 uint(balance,'ETH balance');uint(gasPrice,'gas price',true);
 if(recipientCode&&recipientCode!=='0x')throw new Error('Native sweep recipient has code');
 if(estimatedGas!==21000n)throw new Error('Native sweep requires exactly 21000 measured gas');
 const value=balance-estimatedGas*gasPrice;
 if(value<=0n)throw new Error('Native sweep funding shortfall');
 return {value,gas:estimatedGas,gasPrice,type:'legacy'};
}
