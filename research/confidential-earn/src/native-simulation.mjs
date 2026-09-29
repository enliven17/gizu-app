// Ephemeral fork execution. No private key is accepted or used by this module.
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createPublicClient,http,toHex} from 'viem';
import {mainnet} from 'viem/chains';
import {depositCalls,redeemCalls,tokenBalance,vault} from './native-vault.mjs';
import {gasBudget,ceilDiv} from './native-gas.mjs';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function freePort(){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});const port=server.address().port;await new Promise(r=>server.close(r));return port;}
export async function withNativeFork({rpcUrl,blockNumber,anvilPath='anvil',chain=mainnet,allowSameTimestamp=false},fn) {
 const port=await freePort();
 const process=spawn(anvilPath,['--fork-url',rpcUrl,'--fork-block-number',String(blockNumber),'--host','127.0.0.1','--port',String(port),'--chain-id',String(chain.id),'--hardfork','prague','--accounts','0','--silent'],{stdio:'ignore'});
 let failed;process.on('error',()=>{failed=true;});
 const client=createPublicClient({chain,transport:http(`http://127.0.0.1:${port}`,{retryCount:0,timeout:60000}),cacheTime:0});
 try {
  let ready=false;
  for(let i=0;i<200;i++) {if(failed||process.exitCode!==null)throw new Error('Anvil could not start; check ANVIL_PATH and archive RPC');try{ready=/anvil/i.test(await client.request({method:'web3_clientVersion'}));if(ready)break;}catch{}await pause(100);}
  if(!ready)throw new Error('Anvil startup timed out');
  if(await client.getChainId()!==chain.id||(await client.getBlock()).number!==blockNumber)throw new Error('Simulation fork does not match reference block');
  if(allowSameTimestamp)await client.request({method:'anvil_setBlockTimestampInterval',params:[0]});
  return await fn(client);
 } finally {process.kill('SIGTERM');await Promise.race([new Promise(r=>process.once('exit',r)),pause(1000)]);if(process.exitCode===null)process.kill('SIGKILL');}
}
export async function simulateSequence(client,owner,calls,fee,{timestamp}={}) {
 await client.request({method:'anvil_impersonateAccount',params:[owner]});
 await client.request({method:'anvil_setBalance',params:[owner,toHex(10n**22n)]});
 const rows=[];
 for(const call of calls) {
  const gas=await client.estimateGas({account:owner,...call,maxFeePerGas:fee,maxPriorityFeePerGas:0n});
  // This fee is simulation-only. The planner supplies a live fee cap separately.
  await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:['0x0']});
  if(timestamp!==undefined)await client.request({method:'evm_setNextBlockTimestamp',params:[Number(timestamp)]});
  const hash=await client.request({method:'eth_sendTransaction',params:[{from:owner,to:call.to,data:call.data,value:toHex(call.value??0n),gas:toHex(ceilDiv(gas*150n,100n)),maxFeePerGas:toHex(fee),maxPriorityFeePerGas:'0x0'}]});
  let receipt;for(let i=0;i<100;i++){receipt=await client.getTransactionReceipt({hash}).catch(()=>null);if(receipt)break;await pause(50);}
  if(receipt?.status!=='success')throw new Error('Exact native call reverted on the pinned fork');
  rows.push({estimatedGas:gas,actualGas:receipt.gasUsed,to:call.to,data:call.data,hash});
 }
 return rows;
}
export async function simulateNative({rpcUrl,anvilPath,block,owner,amount,shares,fees,initialShares=0n}) {
 return withNativeFork({rpcUrl,anvilPath,blockNumber:block.number},async client=>{
  const deadline=block.timestamp+3600n;
  let deposit=[];
  if(amount!==undefined) {
   if(await tokenBalance(client,vault,owner)!==initialShares)throw new Error('Simulation existing share baseline changed');
   const prepared=await depositCalls({client,owner,amount,deadline});
   deposit=await simulateSequence(client,owner,prepared.calls,fees.depositFee);
   shares=await tokenBalance(client,vault,owner);
  }
  const redemption=await redeemCalls({client,owner,shares,deadline});
  const withdrawal=await simulateSequence(client,owner,redemption.calls,fees.depositFee);
  const withdrawalGas=withdrawal.map(r=>r.estimatedGas);
  return {referenceBlock:block.number,referenceHash:block.hash,deposit,withdrawal,
   ...(deposit.length?{budget:gasBudget({depositGas:deposit.map(r=>r.estimatedGas),withdrawGas:withdrawalGas,depositFee:fees.depositFee,withdrawFee:fees.withdrawFee})}:{}),
   withdrawalGas,withdrawalMaximum:withdrawalGas.reduce((sum,g)=>sum+ceilDiv(g*130n,100n),0n)*fees.depositFee};
 });
}
