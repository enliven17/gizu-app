import assert from 'node:assert/strict';
import {createPublicClient,http,getAddress,erc20Abi,decodeFunctionData,pad} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {toSimple7702SmartAccount,entryPoint08Address,formatUserOperationRequest,getUserOperationHash} from 'viem/account-abstraction';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';
import {prepareUserOperationForErc20Paymaster} from 'permissionless/experimental/pimlico';
import {erc20BalanceOverride} from 'permissionless/utils';
import {tokenCostCap} from './token-earn-policy.mjs';
import {hood} from './robinhood-vault.mjs';
export const tokenPaymaster=getAddress('0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402');
export async function createHoodPaymaster({client,owner,env=process.env}){
 if(await client.getChainId()!==4663)throw new Error('Expected Robinhood chain 4663');
 if(!env.PIMLICO_API_KEY)throw new Error('Missing PIMLICO_API_KEY');
 const endpoint=`https://api.pimlico.io/v2/4663/rpc?apikey=${encodeURIComponent(env.PIMLICO_API_KEY)}`;
 const signer=()=>{const a=privateKeyToAccount(env.DEST2_PK);if(a.address!==owner)throw new Error('Robinhood destination key mismatch');return a;};
 // Address-only owner supports estimates but cannot authorize a transaction.
 const refuse=async()=>{throw new Error('Preview account cannot sign');};
 const account=await toSimple7702SmartAccount({client,owner:{address:owner,type:'local',signMessage:refuse,signTypedData:refuse,signTransaction:refuse}});
 const code=await client.getCode({address:owner})??'0x';
 if(code!=='0x'&&code.toLowerCase()!==`0xef0100${account.authorization.address.slice(2)}`.toLowerCase())throw new Error('Unknown Robinhood wallet delegation');
 const pimlico=createPimlicoClient({chain:hood.chain,transport:http(endpoint,{timeout:30000,retryCount:0}),entryPoint:{address:entryPoint08Address,version:'0.8'}});
 const supported=await pimlico.getSupportedEntryPoints();
 if(!supported.some(a=>a.toLowerCase()===entryPoint08Address.toLowerCase()))throw new Error('Pimlico lacks EntryPoint v0.8 on Robinhood');
 if((await client.getCode({address:tokenPaymaster})??'0x')==='0x')throw new Error('Robinhood token paymaster not deployed');
 const transport=http(endpoint,{timeout:30000,retryCount:0});
 async function prepare(calls,{stateOverride,balanceOverride=false,authorization,nonce,sponsor=false,feeFloor,_attempt=0}={}){
  const fees=(await pimlico.getUserOperationGasPrice()).standard;
  if(feeFloor){fees.maxFeePerGas=fees.maxFeePerGas>feeFloor.maxFeePerGas?fees.maxFeePerGas:feeFloor.maxFeePerGas;fees.maxPriorityFeePerGas=fees.maxPriorityFeePerGas>feeFloor.maxPriorityFeePerGas?fees.maxPriorityFeePerGas:feeFloor.maxPriorityFeePerGas;}
  if(balanceOverride){
   const [q]=await pimlico.getTokenQuotes({tokens:[hood.token],entryPointAddress:entryPoint08Address,chain:hood.chain});
   if(q?.balanceSlot===undefined)throw new Error('Provider does not expose USDG simulation slot');
   const held=await client.readContract({address:hood.token,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
   const balance=erc20BalanceOverride({token:hood.token,owner,slot:q.balanceSlot,balance:held*2n+1000000000n});
   balance[0].stateDiff=balance[0].stateDiff.map(s=>({...s,value:pad(s.value)}));
   stateOverride=mergeOverrides(stateOverride??[],balance);
  }
  // The live sponsorship service checks current balances and cannot sign a
  // future post-deposit state. Preview uses stub data + the real bundler's
  // estimate; only the explicit execution command requests sponsorship.
  const paymaster={getPaymasterStubData:pimlico.getPaymasterStubData,getPaymasterData:sponsor?pimlico.getPaymasterData:pimlico.getPaymasterStubData};
  const bundler=createSmartAccountClient({account,client,chain:hood.chain,bundlerTransport:transport,paymaster,userOperation:{estimateFeesPerGas:async()=>fees,prepareUserOperation:prepareUserOperationForErc20Paymaster(pimlico)}});
  const op=await bundler.prepareUserOperation({account,calls,paymasterContext:{token:hood.token},...(stateOverride?{stateOverride}:{}),...(authorization?{authorization}:{}),nonce:nonce??await account.getNonce({key:0n})});
  if(op.maxFeePerGas<fees.maxFeePerGas||op.maxPriorityFeePerGas<fees.maxPriorityFeePerGas)throw new Error('Provider reduced the requested fee headroom');
  if(getAddress(op.sender)!==owner||getAddress(op.paymaster)!==tokenPaymaster)throw new Error('Unexpected sender/paymaster');
  const decoded=await account.decodeCalls(op.callData);
  const feeCap=tokenCostCap(op,hood.token);
  const plain=c=>({to:getAddress(c.to),data:c.data??'0x',value:c.value??0n});
  assert.deepEqual(decoded.slice(-calls.length).map(plain),calls.map(plain),'Bundler changed the vault/return calls');
  if(decoded.length===calls.length+1){
   const a=decodeFunctionData({abi:erc20Abi,data:decoded[0].data});
   if(getAddress(decoded[0].to)!==hood.token||a.functionName!=='approve'||getAddress(a.args[0])!==tokenPaymaster)throw new Error('Unexpected paymaster approval target');
   if(a.args[1]+1n<feeCap||a.args[1]>feeCap*101n/100n+1n){
    // SDK token quote and final paymaster data are separate provider requests.
    // Refresh unsigned preparation if their rates drift; never sign a mismatch.
    if(_attempt<2)return prepare(calls,{stateOverride,authorization,nonce,sponsor,feeFloor,_attempt:_attempt+1});
    throw new Error(`Paymaster approval quote did not stabilize (${a.args[1]} against cap ${feeCap}); repeat preview`);
   }
  }
  else if(decoded.length!==calls.length)throw new Error('Unexpected injected calls');
  else if(await client.readContract({address:hood.token,abi:erc20Abi,functionName:'allowance',args:[owner,tokenPaymaster]})+1n<feeCap)throw new Error('Paymaster allowance insufficient');
  return {op,feeCap,fees};
 }
 return {account,pimlico,prepare,
  async authorize(){if((await client.getCode({address:owner})??'0x')!=='0x')return undefined;if(await client.getTransactionCount({address:owner,blockTag:'pending'})!==await client.getTransactionCount({address:owner}))throw new Error('Pending wallet transaction');return signer().signAuthorization({chainId:4663,contractAddress:account.authorization.address,nonce:await client.getTransactionCount({address:owner})});},
  async sign(op){const signingAccount=await toSimple7702SmartAccount({client,owner:signer()});const signature=await signingAccount.signUserOperation(op);const operation={...op,signature};return {hash:getUserOperationHash({chainId:4663,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:operation}),rpcOperation:formatUserOperationRequest(operation)};},
  async submit(signed){const rpc=createPublicClient({transport});const hash=await rpc.request({method:'eth_sendUserOperation',params:[signed.rpcOperation,entryPoint08Address]},{retryCount:0});if(hash.toLowerCase()!==signed.hash.toLowerCase())throw new Error('Bundler returned a different operation hash');return hash;},
  async receipt(hash){try{return await pimlico.getUserOperationReceipt({hash});}catch(e){if(e.name==='UserOperationReceiptNotFoundError')return null;throw e;}},
 };
}
export function mergeOverrides(...groups){
 const addresses=new Map();
 for(const group of groups)for(const item of group){
  const key=item.address.toLowerCase(),old=addresses.get(key)??{},slots=new Map((old.stateDiff??[]).map(s=>[s.slot.toLowerCase(),s]));
  for(const s of item.stateDiff??[])slots.set(s.slot.toLowerCase(),s);
  addresses.set(key,{...old,...item,...(slots.size?{stateDiff:[...slots.values()]}:{})});
 }
 return [...addresses.values()];
}
