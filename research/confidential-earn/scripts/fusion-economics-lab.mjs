// Public reads and unsigned quotes only. All authorizations and executions stay
// on loopback. Tests use current wallet state and the recorded failed-order fee
// scenario, with fresh quote terms; set FUSION_LAB_BLOCK for an archive replay.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createPublicClient,http,toHex,encodeFunctionData,erc20Abi} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {Address,Extension,FusionOrder,LimitOrderContract,TakerTraits,AmountMode} from '@1inch/fusion-sdk';
import {planDeposit} from '../src/native-planner.mjs';
import {quoteNativeEth,fusionSpender,weth} from '../src/fusion-bootstrap.mjs';
import {prepareFusion} from '../src/native-providers.mjs';
import {withNativeFork,simulateNative,simulateSequence} from '../src/native-simulation.mjs';
import {tokenBalance,usdc,vault,depositCalls,redeemCalls} from '../src/native-vault.mjs';
import {ceilDiv} from '../src/native-gas.mjs';
import {json} from '../src/native-runtime.mjs';
const rpcUrl=process.env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com',anvilPath=process.env.ANVIL_PATH||'/private/tmp/anvil';
const publicClient=createPublicClient({transport:http(rpcUrl),cacheTime:0});
const blockNumber=process.env.FUSION_LAB_BLOCK?BigInt(process.env.FUSION_LAB_BLOCK):await publicClient.getBlockNumber();
// Recorded second-attempt fee caps from MAINNET-TEST.md; replay inputs only.
const fees={block:await publicClient.getBlock({blockNumber}),depositFee:675754118n,withdrawFee:1351508236n,priorityFee:100000000n};
const owner=privateKeyToAccount(process.env.DEST2_PK);assert.equal(owner.address.toLowerCase(),process.env.DEST2_ADD.toLowerCase());
const balances=await withNativeFork({rpcUrl,anvilPath,blockNumber},async client=>({usdc:await tokenBalance(client,usdc,owner.address),eth:await client.getBalance({address:owner.address}),shares:await tokenBalance(client,vault,owner.address),weth:await tokenBalance(client,weth,owner.address)}));
assert.equal(balances.usdc,6256264n);assert.equal(balances.eth,0n);
let lastQuote;
const quote=async input=>{lastQuote=await quoteNativeEth({owner:owner.address,input,apiKey:process.env.ONEINCH_API_KEY,resolverGasPrice:fees.depositFee});return lastQuote;};
const plan=await planDeposit({balances,initialShares:balances.shares,price:2700000000n,quote,simulate:options=>simulateNative({rpcUrl,anvilPath,owner:owner.address,block:fees.block,fees,...options})});
console.log(json({stage:'planned',blockNumber,summary:plan.summary}));
const originalFetch=globalThis.fetch;let intercepted=0;
globalThis.fetch=async(input,options)=>{
 const url=new URL(String(input));
 if(url.hostname==='api.1inch.com'){
  assert(url.pathname.includes('/quoter/'),'Public order submission forbidden in lab');
  url.searchParams.delete('permit');url.searchParams.set('enableEstimate','false');
  const r=await originalFetch(url,options),data=await r.json();if(!r.ok)return Response.json(data,{status:r.status});
  data.quoteId=`local-only-${++intercepted}`;return Response.json(data);
 }
 assert.equal(url.hostname,'127.0.0.1','Only unsigned quotes may leave the local test');return originalFetch(input,options);
};
try{
 await withNativeFork({rpcUrl,anvilPath,blockNumber},async client=>{
  const prepared=await prepareFusion({client,owner,...plan.funding,fees,apiKey:process.env.ONEINCH_API_KEY});
  const order=FusionOrder.fromDataAndExtension(prepared.payload.order,Extension.decode(prepared.payload.extension));
  const resolver=prepared.quoteSnapshot.whitelist.find(a=>order.fusionExtension.whitelist.isWhitelisted(new Address(a)));assert(resolver);
  const gross=order.calcTakingAmount(new Address(resolver),order.makingAmount,order.auctionEndTime,0n);
  await simulateSequence(client,resolver,[{to:weth,data:'0xd0e30db0',value:gross*2n},{to:weth,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[fusionSpender,gross*2n]})}],prepared.economics.gasPrice*2n);
  const other=process.env.DEST1_ADD;
  const otherBefore={usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)};
  const traits=TakerTraits.default().setAmountMode(AmountMode.maker).setExtension(order.extension).setAmountThreshold(gross);
  const data=LimitOrderContract.getFillOrderArgsCalldata(order.build(),prepared.payload.signature,traits,order.makingAmount);
  const fills=[];
  for(const offset of [1n,90n,180n]){
   const snapshot=await client.request({method:'evm_snapshot'});
   await client.request({method:'evm_setNextBlockTimestamp',params:[Number(order.auctionStartTime+offset)]});
   await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(prepared.economics.gasPrice)]});
   const hash=await client.request({method:'eth_sendTransaction',params:[{from:resolver,to:fusionSpender,data,gas:toHex(prepared.economics.gasUnits),maxFeePerGas:toHex(prepared.economics.gasPrice),maxPriorityFeePerGas:'0x0'}]});
   const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');
   const actualGasWei=r.gasUsed*r.effectiveGasPrice;
   const marginWei=prepared.economics.inputValueWei-gross-actualGasWei;
   assert(marginWei>=prepared.economics.profitWei,'Fill fails the modeled profitability test');
   assert.equal(await tokenBalance(client,usdc,owner.address),balances.usdc-prepared.input);
   assert(await client.getBalance({address:owner.address})>=plan.simulation.budget.totalWei);
   assert.equal(await tokenBalance(client,weth,owner.address),0n);
   fills.push({offset,gasUsed:r.gasUsed,totalGasPrice:r.effectiveGasPrice,actualGasWei,marginWei});
   if(offset!==180n)await client.request({method:'evm_revert',params:[snapshot]});
  }
  // Spend only the received ETH; do not inject any ETH into the investing wallet.
  await client.request({method:'anvil_impersonateAccount',params:[owner.address]});
  const native=[];
  async function sendCalls(calls,price,margin){for(const call of calls){
   await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(price)]});
   const estimated=await client.estimateGas({account:owner.address,...call,maxFeePerGas:price,maxPriorityFeePerGas:0n});
   const hash=await client.request({method:'eth_sendTransaction',params:[{from:owner.address,to:call.to,data:call.data,gas:toHex(ceilDiv(estimated*margin,100n)),maxFeePerGas:toHex(price),maxPriorityFeePerGas:'0x0'}]});
   const r=await client.waitForTransactionReceipt({hash});assert.equal(r.status,'success');native.push({gasUsed:r.gasUsed,gasPrice:r.effectiveGasPrice});
  }}
  const deadline=(await client.getBlock()).timestamp+3600n;
  await sendCalls((await depositCalls({client,owner:owner.address,amount:plan.amount,deadline})).calls,fees.depositFee,110n);
  assert.equal(await tokenBalance(client,usdc,owner.address),50000n);
  const shares=await tokenBalance(client,vault,owner.address);assert(shares>balances.shares);
  await sendCalls((await redeemCalls({client,owner:owner.address,shares,deadline})).calls,fees.withdrawFee,130n);
  assert.equal(await tokenBalance(client,vault,owner.address),0n);
  assert.deepEqual({usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)},otherBefore);
  const result={scope:'Pinned wallet state; recorded 0.675754118/1.351508236 gwei scenario; fresh unsigned custom quote; exact permit/order signed locally, never sent to provider; resolver inventory funded locally; modeled profitability only; no Aurora return replay',blockNumber,fees:{deposit:fees.depositFee,withdraw:fees.withdrawFee},summary:plan.summary,input:prepared.input,minimumEth:prepared.minimumEth,economics:prepared.economics,fills,native,after:{usdc:await tokenBalance(client,usdc,owner.address),eth:await client.getBalance({address:owner.address}),shares:await tokenBalance(client,vault,owner.address)},otherWalletUnchanged:true};
  await writeFile(new URL('../fixtures/fusion-economics-lab.json',import.meta.url),json(result)+'\n');console.log(json(result));
 });
}finally{globalThis.fetch=originalFetch;}
