// Local execution ONLY. Never use a configurable/public execution endpoint here.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,encodeFunctionData,erc20Abi,getAddress,http,parseAbi,toHex} from 'viem';
import {Address} from '@1inch/fusion-sdk';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {gasBudget,ceilDiv,depositAmount,requireNativeFunding,assertBootstrapSettlement,selectBootstrapQuote,planNativeFunding,assertFreshQuote,nativeSweepPlan,assertCycleComplete} from '../src/native-gas.mjs';
import {depositCalls,redeemCalls,tokenBalance,usdc,vault,auroraTransfer} from '../src/native-vault.mjs';
import {fusionSpender,weth,usdcPermit,localFillData,quoteNativeEth,orderFromQuote} from '../src/fusion-bootstrap.mjs';
import {quoteAuroraReturn} from '../src/aurora-return.mjs';
const client=createPublicClient({chain:mainnet,transport:http('http://127.0.0.1:18564',{timeout:120000,retryCount:0}),cacheTime:0});
assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);
assert.equal(await client.getChainId(),1);
assert.equal(await client.getBlockNumber(),26079549n,'Use a fresh fork');
const owner=privateKeyToAccount(process.env.DEST2_PK);
const wallet=createWalletClient({account:owner,chain:mainnet,transport:http('http://127.0.0.1:18564',{timeout:120000,retryCount:0})});
const historical=JSON.parse(await readFile(new URL('../fixtures/candide-public-transaction.json',import.meta.url),'utf8'));
const other=getAddress(process.env.DEST1_ADD);
assert.notEqual(owner.address,other);
// Resolver impersonation is test liquidity, never wallet-to-wallet funding.
const base=BigInt(historical.block.baseFeePerGas),tip=200000000n;
const fee=base+tip;
const otherBefore={usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)};
const initial=await client.request({method:'evm_snapshot'});
const stringify=x=>JSON.stringify(x,(_k,v)=>typeof v==='bigint'?v.toString():v,2);
let records=[];
const scenario=process.argv[2]??'historical-balance';
assert(['historical-balance','first-payout-balance','larger-balance','withdrawal-1.8x','withdrawal-4x-blocked','return-16x'].includes(scenario),'Unknown scenario');
const repeats=process.argv[3]==='repeat-2'?2:1;
assert(repeats===1||scenario==='larger-balance','Repeat fixture uses the larger balance');
let cycle=0;
const quotes=[];
const fills=[];
let start,simulation;
async function balances(){return {usdc:await tokenBalance(client,usdc,owner.address),eth:await client.getBalance({address:owner.address}),shares:await tokenBalance(client,vault,owner.address)};}
async function send(from,call,{gas,maxFeePerGas=fee,priority=tip,blockBase=base,gasPrice}={}) {
 await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(blockBase)]});
 const fees=gasPrice!==undefined?{type:'legacy',gasPrice}:{maxFeePerGas,maxPriorityFeePerGas:priority};
 const hash=from===owner.address?await wallet.sendTransaction({...call,gas,...fees,nonce:await client.getTransactionCount({address:owner.address})}):await client.request({method:'eth_sendTransaction',params:[{from,to:call.to,data:call.data,value:toHex(call.value??0n),gas:toHex(gas),maxFeePerGas:toHex(maxFeePerGas),maxPriorityFeePerGas:toHex(priority)}]});
 let receipt;
 for(let attempt=0;attempt<200;attempt++) {
  receipt=await client.getTransactionReceipt({hash}).catch(()=>null);
  if(receipt)break;
  await new Promise(resolve=>setTimeout(resolve,150));
 }
 assert(receipt,'Local transaction did not mine; invalidate this test run');
 if(receipt.status!=='success') {
  const trace=await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]});
  await writeFile('/private/tmp/earn-native-failed-trace.json',stringify(trace));
 }
 assert.equal(receipt.status,'success',`Local tx failed: ${hash}`);
 return {hash,gasUsed:receipt.gasUsed,effectiveGasPrice:receipt.effectiveGasPrice,cost:receipt.gasUsed*receipt.effectiveGasPrice,logs:receipt.logs};
}
async function estimate(call,from=owner.address,maxFeePerGas=fee){return client.estimateGas({account:from,...call,maxFeePerGas,maxPriorityFeePerGas:tip,stateOverride:[{address:from,balance:10n**19n}]});}
async function executeCalls(calls,{margin=1000n,reserve=0n,maxFeePerGas=fee,blockBase=base,record=false}={}) {
 const out=[];
 for(const call of calls) {
  const reference=await client.getBlock();
  const estimated=await estimate(call,owner.address,maxFeePerGas),gas=ceilDiv(estimated*(10000n+margin),10000n);
  requireNativeFunding({balance:await client.getBalance({address:owner.address}),gasLimit:gas,maxFeePerGas,reserve});
  const before=await balances();
  const current=await client.getBlock();
  assertFreshQuote({quotedBlock:reference.number,currentBlock:current.number,deadline:reference.timestamp+120n,now:current.timestamp});
  const result=await send(owner.address,call,{gas,maxFeePerGas,blockBase});
  const after=await balances();
  assert.equal(before.eth-after.eth,result.cost);
  assert(!stringify({call,logs:result.logs}).toLowerCase().includes(other.slice(2).toLowerCase()));
  const row={to:call.to,data:call.data,estimatedGas:estimated,gasLimit:gas,maxFeePerGas,baseFeePerGas:blockBase,...result,before,after};
  out.push(row);if(record)records.push(row);
 }
 return out;
}
async function simulateCalls(calls,options) {
 const snapshot=await client.request({method:'evm_snapshot'});
 try {
  await client.request({method:'anvil_setBalance',params:[owner.address,toHex(10n**19n)]});
  return await executeCalls(calls,options);
 } finally {await client.request({method:'evm_revert',params:[snapshot]});}
}
async function fundingQuote(requiredEth,maxInput,price) {
 return selectBootstrapQuote({requiredEth,maxInput,initialInput:ceilDiv(requiredEth*price,10n**18n),quote:async input=>{
  if(quotes.length)await new Promise(resolve=>setTimeout(resolve,1200));
  const q=await quoteNativeEth({owner:owner.address,input,apiKey:process.env.ONEINCH_API_KEY});quotes.push(q);
  console.log(stringify({phase:'unsigned quote',input:q.input,minimumEth:q.minimumEth,requiredEth}));return q;
 }});
}
async function fillQuote(quote,requiredEth,{maxFeePerGas=fee,blockBase=base}={}) {
 const before=await balances();
 const chainTime=(await client.getBlock()).timestamp;
 const now=BigInt(Math.floor(Date.now()/1000));
 orderFromQuote(quote); // Validate provider age/fee policy before signing even the permit.
 const permit=await usdcPermit({client,owner,amount:quote.input,deadline:(now>chainTime?now:chainTime)+3600n});
 const {order,resolver:rawResolver}=orderFromQuote({...quote,permit,nonce:123456789n+BigInt(fills.length)});
 const resolver=getAddress(rawResolver);
 await client.request({method:'anvil_impersonateAccount',params:[resolver]});
 await client.request({method:'anvil_setBalance',params:[resolver,toHex(10n**19n)]});
 assert((await client.getCode({address:order.settlementExtensionContract.toString()}))?.length>2);
 const data=await localFillData({order,owner,resolver});
 const taking=order.calcTakingAmount(new Address(resolver),quote.input,order.auctionEndTime,blockBase);
 await send(resolver,{to:weth,data:'0xd0e30db0',value:taking},{gas:100000n,maxFeePerGas,blockBase});
 await send(resolver,{to:weth,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[fusionSpender,taking]})},{gas:100000n,maxFeePerGas,blockBase});
 const timestamp=(await client.getBlock()).timestamp+1n;
 const inclusionTime=timestamp>order.auctionEndTime?timestamp:order.auctionEndTime;
 assert(inclusionTime<order.deadline,'Local order expired before filling');
 await client.request({method:'evm_setNextBlockTimestamp',params:[Number(inclusionTime)]});
 await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(blockBase)]});await client.request({method:'evm_mine'});
 const call={to:fusionSpender,data,value:0n};
 const estimatedGas=await estimate(call,resolver,maxFeePerGas);
 const fill=await send(resolver,call,{gas:ceilDiv(estimatedGas*110n,100n),maxFeePerGas,blockBase});
 const after=await balances();
 assertBootstrapSettlement({beforeUsdc:before.usdc,afterUsdc:after.usdc,soldUsdc:quote.input,beforeEth:before.eth,afterEth:after.eth,minimumEth:requiredEth});
 assert.equal(after.eth-before.eth,quote.minimumEth,'Auction-end native proceeds match SDK fee calculation');
 assert(!stringify({call,logs:fill.logs}).toLowerCase().includes(other.slice(2).toLowerCase()));
 assert.equal(await tokenBalance(client,weth,owner.address),0n);
 const result={...fill,logs:undefined,estimatedGas,before,after,settlement:order.settlementExtensionContract.toString(),resolver,inclusionTime};fills.push(result);
 await writeFile(new URL(`../.local/native-cycle-fill-${scenario}-${fills.length}.json`,import.meta.url),stringify({call,order:order.build(),extension:order.extension.encode(),taking,...result})+'\n',{mode:0o600});
 return result;
}
async function simulateCycle(amount) {
 const snap=await client.request({method:'evm_snapshot'});
 try {
  // Simulation funding is discarded; the real local cycle must bootstrap from 0 ETH.
  await client.request({method:'anvil_setBalance',params:[owner.address,toHex(10n**18n)]});
  const now=(await client.getBlock()).timestamp;
  const dep=await depositCalls({client,owner:owner.address,amount,deadline:now+3600n});
  const d=await executeCalls(dep.calls);
  const minted=await tokenBalance(client,vault,owner.address);
  const red=await redeemCalls({client,owner:owner.address,shares:minted,deadline:now+3600n});
  const w=await executeCalls(red.calls,{margin:3000n});
  return {deposit:d.map(x=>x.estimatedGas),withdraw:w.map(x=>x.estimatedGas),budget:gasBudget({depositGas:d.map(x=>x.estimatedGas),withdrawGas:w.map(x=>x.estimatedGas),depositFee:fee,withdrawFee:fee*2n})};
 } finally {await client.request({method:'evm_revert',params:[snap]});}
}
try {
 for(cycle=1;cycle<=repeats;cycle++) {
 const cycleQuoteStart=quotes.length,cycleFillStart=fills.length;
 if(cycle>1)assert.deepEqual(await balances(),{usdc:0n,eth:0n,shares:0n},'Prior cycle must be fully drained');
 await client.request({method:'anvil_setBalance',params:[owner.address,'0x0']});
 if(scenario!=='historical-balance') {
  // Local fixture setup only: choose a larger starting balance, independently
  // of gas costs. This is not a proposed production wallet funding transaction.
  const donor=getAddress('0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8');
  await client.request({method:'anvil_impersonateAccount',params:[donor]});
  await client.request({method:'anvil_setBalance',params:[donor,toHex(10n**18n)]});
  const desired=scenario==='first-payout-balance'?5656266n:25000000n;
  const balance=await tokenBalance(client,usdc,owner.address);
  assert(desired>balance);
  await send(donor,{to:usdc,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[owner.address,desired-balance]})},{gas:100000n});
 }
 start=await balances();assert.equal(start.eth,0n);assert.equal(start.shares,0n);
 assert.equal(await client.readContract({address:usdc,abi:erc20Abi,functionName:'allowance',args:[owner.address,fusionSpender]}),0n);
 for(const address of [fusionSpender,weth])assert((await client.getCode({address}))?.length>2);
 const price=await client.readContract({address:getAddress('0x0578cFB241215b77442a541325d6A4E6dFE700Ec'),abi:parseAbi(['function fetchPrice() view returns(uint256)']),functionName:'fetchPrice'});
 const plan=await planNativeFunding({balance:start.usdc,simulate:async amount=>{
  simulation=await simulateCycle(amount);console.log(stringify({phase:'budget',scenario,amount,simulation}));return simulation;
 },quote:(required,maxInput)=>fundingQuote(required,maxInput,price)});
 const {quote,requiredEth:nativeNeeded}=plan;
 const soldUsdc=quote.input,nativeOutput=quote.minimumEth;
 const fill=await fillQuote(quote,nativeNeeded);
 const funded=await balances();
 const amount=depositAmount(funded.usdc);
 const fresh=await simulateCycle(amount);
 assert(funded.eth>=fresh.budget.totalWei,'Exact post-fill operation must fit purchased ETH');
 const dep=await depositCalls({client,owner:owner.address,amount,deadline:(await client.getBlock()).timestamp+600n});
 const deposit=await executeCalls(dep.calls,{reserve:fresh.budget.withdrawWei,record:true});
 const invested=await balances();assert.equal(invested.usdc,50000n);assert(invested.shares>0n);
 const red=await redeemCalls({client,owner:owner.address,shares:invested.shares,deadline:(await client.getBlock()).timestamp+600n});
 const withdrawFee=scenario==='withdrawal-1.8x'?fee*18n/10n:scenario==='withdrawal-4x-blocked'?fee*4n:fee;
 const withdrawBase=withdrawFee-tip;
 const withdrawalPreview=await simulateCalls(red.calls,{margin:3000n,maxFeePerGas:withdrawFee,blockBase:withdrawBase});
 const withdrawalGas=withdrawalPreview.reduce((sum,x)=>sum+x.gasLimit,0n);
 if(scenario==='withdrawal-4x-blocked') {
  assert.throws(()=>requireNativeFunding({balance:invested.eth,gasLimit:withdrawalGas,maxFeePerGas:withdrawFee}),/shortfall/);
  assert.deepEqual(await balances(),invested,'Block before even spending withdrawal approval gas');
  const outcome={scenario,outcome:'withdrawal blocked before spending; shares preserved',start,soldUsdc,nativeOutput,simulation:fresh,invested,withdrawalFee:withdrawFee,requiredWithdrawalWei:withdrawalGas*withdrawFee,quotes:quotes.slice(cycleQuoteStart),fills:fills.slice(cycleFillStart),deposit};
  await writeFile(new URL(`../fixtures/native-cycle-${scenario}${cycle>1?'-cycle-'+cycle:''}.json`,import.meta.url),stringify(outcome)+'\n');console.log(stringify({scenario,outcome:outcome.outcome}));
 } else {
 requireNativeFunding({balance:invested.eth,gasLimit:withdrawalGas,maxFeePerGas:withdrawFee});
 const withdrawal=await executeCalls(red.calls,{margin:3000n,maxFeePerGas:withdrawFee,blockBase:withdrawBase,record:true});
 const withdrawn=await balances();assert.equal(withdrawn.shares,0n);
 // Fresh unfunded route quote happens ONLY after withdrawal. The token
 // transfer remains local and cannot credit Aurora's off-chain service.
 const state=JSON.parse(await readFile(new URL('../.local/state.json',import.meta.url),'utf8'));
 const returnFee=scenario==='return-16x'?fee*16n:withdrawFee;
 const returnBase=returnFee-tip;
 let route,transfer;
 for(let attempt=0;attempt<3;attempt++) {
 const available=await balances();
 route=await quoteAuroraReturn({apiKey:process.env.AURORA_API_KEY,owner:owner.address,confidential:state.confidential,originAsset:state.assets.destination.assetId,destinationAsset:state.assets.private.assetId,amount:available.usdc});
 transfer=auroraTransfer({recipient:route.recipient,amount:available.usdc});
 const gas=ceilDiv((await estimate(transfer,owner.address,returnFee))*110n,100n);
 // Check final native return eligibility BEFORE sending away the USDC.
 // If extra ETH is required, first obtain a route for a gas-cost-sized
 // native deposit; the provider quote, not a fixed dollar amount, gates it.
 const sweepGas=21000n;
 const cleanupFee=sweepGas*returnFee;
 const nativeLowerBound=available.eth-gas*returnFee-cleanupFee;
 const nativeCandidate=nativeLowerBound>0n?nativeLowerBound:cleanupFee;
 const nativePreview=await quoteAuroraReturn({apiKey:process.env.AURORA_API_KEY,owner:owner.address,confidential:state.confidential,originAsset:'nep141:eth.omft.near',destinationAsset:state.assets.private.assetId,amount:nativeCandidate});
 assert.equal(await client.getCode({address:nativePreview.recipient})??'0x','0x','Native return must be an empty-code recipient');
 const shortfall=gas*returnFee+cleanupFee+nativeCandidate-available.eth;
 if(shortfall<=0n)break;
 const topup=await fundingQuote(shortfall,available.usdc-1n,price);
 await fillQuote(topup,shortfall,{maxFeePerGas:returnFee,blockBase:returnBase});
 if(attempt===2)throw new Error('Return funding did not converge');
 }
 await writeFile(new URL('../.local/native-cycle-return-quote.json',import.meta.url),stringify(route)+'\n',{mode:0o600});
 const returnRecipient=route.recipient;
 assert.notEqual(returnRecipient,owner.address);assert.notEqual(returnRecipient,other);
 assert((await client.getBlock()).timestamp<route.deadline,'Return quote expired on local chain');
 const recipientBefore=await tokenBalance(client,usdc,returnRecipient);
 const returnAmount=(await balances()).usdc;
 const returned=await executeCalls([transfer],{maxFeePerGas:returnFee,blockBase:returnBase,record:true});
 const afterUsdcReturn=await balances();assert.equal(afterUsdcReturn.usdc,0n);assert.equal(afterUsdcReturn.shares,0n);
 const provisional=nativeSweepPlan({balance:afterUsdcReturn.eth,gasPrice:returnFee,estimatedGas:21000n,recipientCode:'0x'});
 const nativeRoute=await quoteAuroraReturn({apiKey:process.env.AURORA_API_KEY,owner:owner.address,confidential:state.confidential,originAsset:'nep141:eth.omft.near',destinationAsset:state.assets.private.assetId,amount:provisional.value});
 assert.notEqual(nativeRoute.recipient,other);assert.notEqual(nativeRoute.recipient,owner.address);
 assert((await client.getBlock()).timestamp<nativeRoute.deadline);
 const nativeCall={to:nativeRoute.recipient,value:provisional.value,data:'0x'};
 const nativeEstimate=await client.estimateGas({account:owner.address,...nativeCall,gasPrice:returnFee,stateOverride:[{address:owner.address,balance:10n**19n}]});
 const sweep=nativeSweepPlan({balance:await client.getBalance({address:owner.address}),gasPrice:returnFee,estimatedGas:nativeEstimate,recipientCode:await client.getCode({address:nativeRoute.recipient})});
 assert.equal(sweep.value,provisional.value,'Balance changed since native return quote');
 const nativeRecipientBefore=await client.getBalance({address:nativeRoute.recipient});
 const nativeReceipt=await send(owner.address,nativeCall,{gas:sweep.gas,gasPrice:sweep.gasPrice,blockBase:returnBase});
 assert.equal(nativeReceipt.gasUsed,sweep.gas);assert.equal(nativeReceipt.effectiveGasPrice,sweep.gasPrice);
 assert.equal(await client.getBalance({address:nativeRoute.recipient})-nativeRecipientBefore,sweep.value);
 assert(!stringify({nativeCall,logs:nativeReceipt.logs}).toLowerCase().includes(other.slice(2).toLowerCase()));
 const end=await balances();assert.equal(end.usdc,0n);assert.equal(end.eth,0n);assert.equal(end.shares,0n);
 const completion=assertCycleComplete({...end,ethPriceUsdc:price});
 const nativeReturned={...nativeReceipt,call:nativeCall,...sweep,minimumOut:nativeRoute.minimumOut,deadline:nativeRoute.deadline};
 await writeFile(new URL(`../.local/native-cycle-native-return-${scenario}.json`,import.meta.url),stringify(nativeRoute)+'\n',{mode:0o600});
 assert.equal(await tokenBalance(client,usdc,returnRecipient)-recipientBefore,returnAmount);
 const outcome={cycle,scope:'Local execution of unsigned live Fusion quotes with a locally impersonated quoted resolver. Not public order admission. Fresh unfunded Aurora advanced USDC and ETH quotes; transfers executed locally only, no private credit.',scenario,forkBlock:26079549,baseFeePerGas:base,priorityFeePerGas:tip,owner:owner.address,start,soldUsdc,nativeOutput,quotes:quotes.slice(cycleQuoteStart),simulation:fresh,fills:fills.slice(cycleFillStart),invested,withdrawn,afterUsdcReturn,end,completion,nativeReturned,deposit,withdrawal,returned,aurora:{depositAddress:returnRecipient,minimumOut:route.minimumOut,deadline:route.deadline,confidentiality:'advanced',mainnetFunded:false},otherDestinationAbsent:true};
 await writeFile(new URL(`../fixtures/native-cycle-${scenario}${cycle>1?'-cycle-'+cycle:''}.json`,import.meta.url),stringify(outcome)+'\n');
 console.log(stringify({...outcome,deposit:deposit.map(({logs,data,...r})=>r),withdrawal:withdrawal.map(({logs,data,...r})=>r),returned:returned.map(({logs,data,...r})=>r)}));
 }
}
} catch(error) {
 if(error.message==='Insufficient affordable Fusion output') {
  const after=await balances();assert.deepEqual(after,start);
  const result={scenario,outcome:'blocked before signing or spending',reason:error.message,start,simulation,quotes};
  await writeFile(new URL(`../fixtures/native-cycle-${scenario}${cycle>1?'-cycle-'+cycle:''}.json`,import.meta.url),stringify(result)+'\n');
  console.log(stringify({scenario,outcome:result.outcome,reason:error.message}));
 }else throw error;
} finally {
 const otherAfter={usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)};
 await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_revert',params:[initial]});await client.request({method:'anvil_dropAllTransactions'});assert.deepEqual(otherAfter,otherBefore,'Wallet 1 balances must remain unchanged');}
