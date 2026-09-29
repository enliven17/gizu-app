// Public reads only. The fixture supplies a public address; no .env or key is read.
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,decodeFunctionData,erc20Abi,http,parseAbi} from 'viem';
import {entryPoint08Abi,toUserOperation} from 'viem/account-abstraction';
import {circleFeeCap,circlePaymaster,vaultAddress} from '../src/vault-deposit.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/candide-public-transaction.json',import.meta.url),'utf8'));
const op=toUserOperation(decodeFunctionData({abi:entryPoint08Abi,data:fixture.tx.input}).args[0][0]);
const token='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const client=createPublicClient({transport:http('https://ethereum-rpc.publicnode.com')});
const block=await client.getBlock({blockTag:'latest'});
const abi=parseAbi(['function fetchPrice() view returns(uint256)','function feeSpread() view returns(uint32)','function additionalGasCharge() view returns(uint32)']);
const [usdc,shares,eth,price,spread,additional,relay]=await Promise.all([
 client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[op.sender],blockNumber:block.number}),
 client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[op.sender],blockNumber:block.number}),
 client.getBalance({address:op.sender,blockNumber:block.number}),
 ...['fetchPrice','feeSpread','additionalGasCharge'].map(functionName=>client.readContract({address:circlePaymaster,abi,functionName,blockNumber:block.number})),
 fetch('https://public.pimlico.io/v2/1/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'pimlico_getUserOperationGasPrice',params:[]})}).then(r=>r.json()),
]);
const pricing={nativeTokenPrice:price,feeSpread:BigInt(spread),additionalGasCharge:BigInt(additional)};
function threshold(limit){let lo=1n,hi=10n**12n;while(lo<hi){const mid=(lo+hi+1n)/2n;if(circleFeeCap({...op,maxFeePerGas:mid},pricing)<limit)lo=mid;else hi=mid-1n;}return lo;}
const result={observedAt:new Date().toISOString(),block:block.number,blockHash:block.hash,owner:op.sender,usdc,shares,eth,baseFeePerGas:block.baseFeePerGas,circlePricing:pricing,scope:'Maximum-fee thresholds use the historical Candide gas limits, not a fresh operation estimate',maximumFeeForStrictHalf:threshold(500000n),maximumFeeForStrictPointOne:threshold(100000n),pimlicoGasQuote:relay.result??relay.error};
const json=JSON.stringify(result,(_k,v)=>typeof v==='bigint'?v.toString():v,2);
await writeFile(new URL('../fixtures/live-read-only-state.json',import.meta.url),json+'\n');console.log(json);
