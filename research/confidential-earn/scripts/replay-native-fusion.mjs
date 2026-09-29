// Replay the saved mainnet order on loopback only; never sign or submit publicly.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {Address,Extension,FusionOrder,LimitOrderContract,TakerTraits,AmountMode} from '@1inch/fusion-sdk';
import {encodeFunctionData,erc20Abi,toHex} from 'viem';
import {withNativeFork,simulateSequence} from '../src/native-simulation.mjs';
import {quoteNativeEth,fusionSpender,weth} from '../src/fusion-bootstrap.mjs';
import {tokenBalance,usdc,vault} from '../src/native-vault.mjs';
import {json} from '../src/native-runtime.mjs';
const state=JSON.parse(await readFile(new URL('../.local/ethereum/native-earn-2.json',import.meta.url),'utf8'),(_k,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$nativeInteger==='string'?BigInt(v.$nativeInteger):v);
const saved=state.pending?.type==='fusion'?state.pending:state.orders.at(-1);
assert(saved?.payload,'No saved Fusion order');
const order=FusionOrder.fromDataAndExtension(saved.payload.order,Extension.decode(saved.payload.extension));
assert.equal(order.getOrderHash(1),saved.hash);
const quote=await quoteNativeEth({owner:state.bindings.owner,input:saved.input,apiKey:process.env.ONEINCH_API_KEY});
const resolver=quote.response.whitelist.find(address=>order.fusionExtension.whitelist.isWhitelisted(new Address(address)));
assert(resolver,'No full resolver address matches the saved whitelist');
await withNativeFork({rpcUrl:process.env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com',blockNumber:saved.fromBlock,anvilPath:process.env.ANVIL_PATH},async client=>{
 assert.equal(new URL(client.transport.url).hostname,'127.0.0.1');
 const owner=state.bindings.owner,before={usdc:await tokenBalance(client,usdc,owner),eth:await client.getBalance({address:owner}),shares:await tokenBalance(client,vault,owner)};
 assert.equal(before.usdc,saved.before.usdc);assert.equal(before.eth,saved.before.eth);
 const base=(await client.getBlock()).baseFeePerGas,fee=base*2n+100000000n;
 const taking=order.calcTakingAmount(new Address(resolver),order.makingAmount,order.auctionEndTime,base);
 await simulateSequence(client,resolver,[{to:weth,data:'0xd0e30db0',value:taking*2n},{to:weth,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[fusionSpender,taking*2n]})}],fee);
 assert((await client.getBlock()).timestamp<order.auctionEndTime,'Fork setup crossed the auction end');
 await client.request({method:'evm_setNextBlockTimestamp',params:[Number(order.auctionEndTime)]});
 await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(base)]});
 const traits=TakerTraits.default().setAmountMode(AmountMode.maker).setExtension(order.extension).setAmountThreshold(taking*2n);
 const data=LimitOrderContract.getFillOrderArgsCalldata(order.build(),saved.payload.signature,traits,order.makingAmount);
 const hash=await client.request({method:'eth_sendTransaction',params:[{from:resolver,to:fusionSpender,data,gas:'0x1e8480',maxFeePerGas:toHex(fee),maxPriorityFeePerGas:'0x0'}]});
 const receipt=await client.waitForTransactionReceipt({hash});
 if(receipt.status!=='success'){
  const trace=await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]});
  await writeFile(new URL('../.local/mainnet-preflight/fusion-replay-failure.json',import.meta.url),json(trace),{mode:0o600});
 }
 assert.equal(receipt.status,'success','Saved signed Fusion order reverted on the pinned fork');
 const after={usdc:await tokenBalance(client,usdc,owner),eth:await client.getBalance({address:owner}),shares:await tokenBalance(client,vault,owner),weth:await tokenBalance(client,weth,owner)};
 assert.equal(before.usdc-after.usdc,saved.input);assert(after.eth-before.eth>=saved.minimumEth);assert.equal(after.shares,before.shares);assert.equal(after.weth,0n);
 const result={scope:'Exact saved order, extension and signature on a local fork at the preparation block; resolver liquidity supplied locally; no public submission',orderHash:saved.hash,block:saved.fromBlock,resolver,gasUsed:receipt.gasUsed,before,after,minimumEth:saved.minimumEth};
 await writeFile(new URL('../fixtures/native-fusion-signed-replay.json',import.meta.url),json(result)+'\n');console.log(json(result));
});
