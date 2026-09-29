import {encodeFunctionData,erc20Abi,parseAbi} from 'viem';
import {vaultV2Deposit,vaultV2Redeem} from '@morpho-org/morpho-sdk';
import {routeProfile} from './routes.mjs';
import {ceilDiv} from './native-gas.mjs';
import {withNativeFork,simulateSequence} from './native-simulation.mjs';
export const hood=routeProfile('robinhood');
export const vaultAbi=parseAbi(['function asset() view returns(address)','function previewDeposit(uint256) view returns(uint256)','function previewRedeem(uint256) view returns(uint256)','function maxRedeem(address) view returns(uint256)']);
export const approve=(token,spender,amount)=>({to:token,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[spender,amount]})});
export const transfer=(recipient,amount)=>({to:hood.token,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[recipient,amount]})});
export async function hoodCalls({client,owner,kind,amount,deadline}){
 let tx;
 if(kind==='deposit'){
  const shares=await client.readContract({address:hood.vault,abi:vaultAbi,functionName:'previewDeposit',args:[amount]});
  if(shares<=0n)throw new Error('Deposit produces zero shares');
  tx=vaultV2Deposit({vault:{chainId:4663,address:hood.vault,asset:hood.token},args:{amount,userAddress:owner,maxSharePrice:ceilDiv(amount*10n**27n*10010n,shares*10000n),deadline}});
 }else{
  tx=vaultV2Redeem({vault:{chainId:4663,address:hood.vault},args:{shares:amount,userAddress:owner,deadline}});
 }
 if((await client.getCode({address:tx.to})??'0x')==='0x')throw new Error('Established Morpho vault router is not deployed');
 // Exact approval inside the same wallet's atomic UserOperation.
 return [approve(kind==='deposit'?hood.token:hood.vault,tx.to,amount),{to:tx.to,data:tx.data,value:tx.value??0n}];
}
export async function simulateHoodDeposit({rpcUrl,anvilPath,block,owner,amount}){
 return withNativeFork({rpcUrl,anvilPath,blockNumber:block.number,chain:hood.chain,allowSameTimestamp:true},async client=>{
  const deadline=block.timestamp+3600n;
  const calls=await hoodCalls({client,owner,kind:'deposit',amount,deadline});
  const deposited=await simulateSequence(client,owner,calls,10n**9n,{timestamp:block.timestamp});
  const changed=new Map();
  for(const row of deposited){
   const trace=await client.request({method:'debug_traceTransaction',params:[row.hash,{tracer:'prestateTracer',tracerConfig:{diffMode:true}}]});
   for(const address of new Set([...Object.keys(trace.pre??{}),...Object.keys(trace.post??{})])){
    const previous=trace.pre?.[address]?.storage??{},current=trace.post?.[address]?.storage??{};
    const slots=changed.get(address)??{};
    for(const slot of Object.keys(previous))if(!(slot in current))slots[slot]='0x'+'0'.repeat(64);
    Object.assign(slots,current);if(Object.keys(slots).length)changed.set(address,slots);
   }
  }
  const stateOverride=[...changed].map(([address,storage])=>({address,stateDiff:Object.entries(storage).map(([slot,value])=>({slot,value}))}));
  const shares=await client.readContract({address:hood.vault,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
  const withdrawalCalls=await hoodCalls({client,owner,kind:'withdraw',amount:shares,deadline});
  const withdrawn=await simulateSequence(client,owner,withdrawalCalls,10n**9n,{timestamp:block.timestamp});
  if(await client.readContract({address:hood.vault,abi:erc20Abi,functionName:'balanceOf',args:[owner]})!==0n)throw new Error('Simulated redemption left shares');
  return {shares,withdrawalCalls,stateOverride,depositGas:deposited.map(r=>r.actualGas),withdrawalGas:withdrawn.map(r=>r.actualGas),referenceBlock:block.number};
 });
}
