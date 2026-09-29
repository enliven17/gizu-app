// Mainnet bytecode fork; synthetic wallets. All transaction submissions are
// loopback-only. Real Pimlico estimates; local paymaster signer and Aurora mocks.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicClient,http,parseAbi,encodeFunctionData,erc20Abi,toHex,pad,parseEventLogs,keccak256,encodeAbiParameters} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {entryPoint08Address,entryPoint08Abi,toPackedUserOperation,formatUserOperation} from 'viem/account-abstraction';
import {erc20BalanceOverride} from 'permissionless/utils';
import {withNativeFork} from '../src/native-simulation.mjs';
import {hood} from '../src/robinhood-vault.mjs';
import {createHoodPaymaster,mergeOverrides,tokenPaymaster} from '../src/robinhood-paymaster.mjs';
import {hoodContext,runRobinhood} from '../src/robinhood-cli.mjs';
import {json} from '../src/native-runtime.mjs';
const upstream=process.env.ROBINHOOD_RPC_URL||hood.rpc;
const publicClient=createPublicClient({chain:hood.chain,transport:http(upstream,{timeout:30000})});
const block=await publicClient.getBlock();
const root=await mkdtemp(join(tmpdir(),'hood-cycle-'));await mkdir(join(root,hood.directory),{recursive:true,mode:0o700});
const owner=privateKeyToAccount(generatePrivateKey()),pmSigner=privateKeyToAccount(generatePrivateKey());
const other=privateKeyToAccount(generatePrivateKey()).address,source=privateKeyToAccount(generatePrivateKey()).address;
const confidential=privateKeyToAccount(generatePrivateKey()).address;
const asset='nep141:hood-0x5fc5360d0400a0fd4f2af552add042d716f1d168.omft.near';
const originalFetch=globalThis.fetch,receipts=new Map(),evidence=[],signedOperations=[];let routeSuccess=false,submissions=0,overrides=[];
globalThis.fetch=async(input,options)=>{
 const url=new URL(String(input));
 if(url.hostname==='intents-api.aurora.dev'){
  if(url.pathname.includes('/tokens/'))return Response.json({tokens:[{assetId:asset,price:1,priceUpdatedAt:new Date().toISOString()},{assetId:'nep141:hood.omft.near',price:2800,priceUpdatedAt:new Date().toISOString()}]});
  if(url.pathname.includes('/status/'))return Response.json({status:routeSuccess?'SUCCESS':'PROCESSING'});
  if(url.pathname.includes('/quote/')){const request=JSON.parse(options.body);return Response.json({quoteRequest:request,signature:'local-only',quote:{depositAddress:privateKeyToAccount(generatePrivateKey()).address,amountIn:request.amount,amountOut:request.amount,minAmountOut:request.amount,deadline:new Date(Date.now()+600000).toISOString()}});}
  throw new Error('Unexpected Aurora endpoint');
 }
 if(url.hostname.includes('pimlico')&&options?.body){const method=JSON.parse(options.body).method;assert(!['eth_sendUserOperation','eth_sendRawTransaction','pm_getPaymasterData'].includes(method),'Public signing/submission forbidden');}
 return originalFetch(input,options);
};
try{await withNativeFork({rpcUrl:upstream,blockNumber:block.number,anvilPath:process.env.ANVIL_PATH||'anvil',chain:hood.chain},async client=>{
 const rpc=client.transport.url;assert(new URL(rpc).hostname==='127.0.0.1');
 const env={...process.env,ROBINHOOD_RPC_URL:rpc,DEST2_ADD:owner.address,DEST2_PK:undefined,DEST1_ADD:other,SOURCE_ADD:source};
 // Keep the synthetic private key in a signer closure, not in any artifact.
 const epEvents=parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
 const pmAbi=parseAbi(['function signers(address) view returns(bool)','function getHash(uint8,(address sender,uint256 nonce,bytes initCode,bytes callData,bytes32 accountGasLimits,uint256 preVerificationGas,bytes32 gasFees,bytes paymasterAndData,bytes signature)) view returns(bytes32)']);
 async function traceOverrides(hash){const trace=await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'prestateTracer',tracerConfig:{diffMode:true}}]});const group=[];for(const address of new Set([...Object.keys(trace.pre??{}),...Object.keys(trace.post??{})])){const pre=trace.pre?.[address]?.storage??{},post=trace.post?.[address]?.storage??{};const slots={...post};for(const k of Object.keys(pre))if(!(k in post))slots[k]=toHex(0n,{size:32});if(Object.keys(slots).length)group.push({address,stateDiff:Object.entries(slots).map(([slot,value])=>({slot,value:pad(value)}))});}overrides=mergeOverrides(overrides,group);}
 async function localSend(from,to,data,value=0n){await client.request({method:'anvil_impersonateAccount',params:[from]});await client.request({method:'anvil_setBalance',params:[from,toHex(10n**20n)]});const hash=await client.request({method:'eth_sendTransaction',params:[{from,to,data,value:toHex(value),gas:'0x989680'}]});const r=await client.waitForTransactionReceipt({hash});if(r.status!=='success'){const t=await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]});const errors=[];function walk(x){if(x.error)errors.push({to:x.to,error:x.error,output:x.output});for(const child of x.calls??[])walk(child);}walk(t);console.error(json(errors));}assert.equal(r.status,'success');await traceOverrides(hash);return r;}
 const initialAA=await createHoodPaymaster({client,owner:owner.address,env});
 const delegation=`0xef0100${initialAA.account.authorization.address.slice(2)}`;
 await client.request({method:'anvil_setCode',params:[owner.address,delegation]});overrides=[{address:owner.address,code:delegation}];
 const tokenOverride=erc20BalanceOverride({token:hood.token,owner:owner.address,slot:1n,balance:10000000n});tokenOverride[0].stateDiff[0].value=pad(tokenOverride[0].stateDiff[0].value);
 await client.request({method:'anvil_setStorageAt',params:[hood.token,tokenOverride[0].stateDiff[0].slot,tokenOverride[0].stateDiff[0].value]});overrides=mergeOverrides(overrides,tokenOverride);
 assert.equal(await client.readContract({address:hood.token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),10000000n);
 // Discover and change only the local fork's signer mapping; verify via getter.
 let signerSlot;
 for(let i=0n;i<8n;i++){
  const slot=keccak256(encodeAbiParameters([{type:'address'},{type:'uint256'}],[pmSigner.address,i]));
  const previous=await client.getStorageAt({address:tokenPaymaster,slot});
  await client.request({method:'anvil_setStorageAt',params:[tokenPaymaster,slot,toHex(1n,{size:32})]});
  if(await client.readContract({address:tokenPaymaster,abi:pmAbi,functionName:'signers',args:[pmSigner.address]})){signerSlot=slot;break;}
  await client.request({method:'anvil_setStorageAt',params:[tokenPaymaster,slot,previous]});
 }
 assert(signerSlot,'Could not configure local-only paymaster signer');
 const beneficiary=privateKeyToAccount(generatePrivateKey()).address;
 await localSend(beneficiary,entryPoint08Address,encodeFunctionData({abi:entryPoint08Abi,functionName:'depositTo',args:[tokenPaymaster]}),10n**18n);
 await writeFile(join(root,hood.directory,'state.json'),JSON.stringify({route:'robinhood',chainId:4663,recipients:[other,owner.address],confidential,payouts:[{status:'delivered'},{status:'delivered'}],assets:{destination:{contractAddress:hood.token,decimals:6,assetId:asset},private:{decimals:6,assetId:'local-private-usdc'}}}),{mode:0o600});
 const paymasterFactory=async args=>{
  const aa=await createHoodPaymaster(args),prepare=aa.prepare;
  aa.prepare=async(calls,options={})=>{
   let p;const merged=mergeOverrides(overrides,options.stateOverride??[]).filter(a=>a.address.toLowerCase()!==entryPoint08Address.toLowerCase());
   // Public estimator checks public nonce before applying storage overrides.
   // Estimate this synthetic wallet at public nonce zero; execute sequential
   // nonces locally. This does not prove public admission of the local nonce.
   const executionNonce=options.nonce??await aa.account.getNonce({key:0n});
   p=await prepare(calls,{...options,sponsor:false,stateOverride:merged,nonce:0n});
   p.op.nonce=executionNonce;
   if(options.sponsor){const digest=await client.readContract({address:tokenPaymaster,abi:pmAbi,functionName:'getHash',args:[1,toPackedUserOperation(p.op)]});const sig=await pmSigner.signMessage({message:{raw:digest}});p.op.paymasterData=p.op.paymasterData.slice(0,-130)+sig.slice(2);}
   return p;
  };
  const {toSimple7702SmartAccount,getUserOperationHash,formatUserOperationRequest}=await import('viem/account-abstraction');
  aa.sign=async op=>{const account=await toSimple7702SmartAccount({client,owner});const operation={...op,signature:await account.signUserOperation(op)};return {hash:getUserOperationHash({chainId:4663,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:operation}),rpcOperation:formatUserOperationRequest(operation)};};
  aa.authorize=async()=>undefined;
  aa.submit=async signed=>{submissions++;const op=formatUserOperation(signed.rpcOperation);const receipt=await localSend(beneficiary,entryPoint08Address,encodeFunctionData({abi:entryPoint08Abi,functionName:'handleOps',args:[[toPackedUserOperation(op)],beneficiary]}));const event=parseEventLogs({abi:epEvents,logs:receipt.logs}).find(e=>e.args.userOpHash===signed.hash);assert(event,'Missing operation event');assert.equal(event.args.success,true);const included=await client.getBlock({blockNumber:receipt.blockNumber});signedOperations.push({signed,timestamp:included.timestamp,baseFeePerGas:included.baseFeePerGas,actualGasUsed:event.args.actualGasUsed});receipts.set(signed.hash,{sender:owner.address,success:true,receipt});await client.request({method:'anvil_mine',params:['0x3']});return signed.hash;};
  aa.receipt=async hash=>receipts.get(hash)??null;
  return aa;
 };
 const contextFactory=async args=>hoodContext({...args,paymasterFactory});
 const command=(name,detail)=>runRobinhood(name,'2',detail,{root,env,contextFactory,print:()=>{}});
 const preview=await command('preview','deposit');assert.equal(submissions,0);console.log(json({phase:'preview',deposit:preview.amount,depositCap:preview.feeCap,withdrawalReserve:preview.withdrawalReserve,simulation:preview.simulation.depositGas}));
 evidence.push({kind:'preview',amount:preview.amount,feeCap:preview.feeCap,withdrawalReserve:preview.withdrawalReserve});
 for(const kind of ['deposit','withdraw','return']){await command(kind);const s=await command('earn-status');const op=s.operations.at(-1);const b=await(await contextFactory({root,env,save:async()=>{}})).balances();evidence.push({kind,amount:op.amount,feeCap:op.feeCap,balances:b,phase:s.phase});console.log(json(evidence.at(-1)));}
 const beforeSuccess=await command('earn-status');assert.equal(beforeSuccess.phase,'awaiting_aurora');routeSuccess=true;const done=await command('earn-status');assert.equal(done.phase,'complete');assert.equal(done.residual.optimal,true);
 const otherBalance=await client.readContract({address:hood.token,abi:erc20Abi,functionName:'balanceOf',args:[other]});assert.equal(otherBalance,0n);
 await writeFile(new URL('../fixtures/robinhood-cycle.json',import.meta.url),json({scope:'Local Robinhood fork, public Pimlico unsigned estimates at public nonce zero, sequential signed nonces executed locally, local-only paymaster signer, preinstalled delegation, mocked Aurora quotes/status. No public sponsorship/inclusion or actual Aurora settlement proven. Fresh authorization tested separately.',block:block.number,submissions,evidence,final:done.residual})+'\n');
 await writeFile(new URL('../fixtures/robinhood-cycle-operations.json',import.meta.url),json({scope:'Synthetic accounts and local-only paymaster signatures for deterministic fork replay. Never submit these operations publicly.',block:block.number,owner:owner.address,pmSigner:pmSigner.address,signerSlot,beneficiary,delegation,initialBalance:10000000n,operations:signedOperations,final:await(await contextFactory({root,env,save:async()=>{}})).balances()})+'\n');
 console.log('Robinhood full CLI cycle passed on local fork.');
 });}finally{globalThis.fetch=originalFetch;await rm(root,{recursive:true,force:true});}
