import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createPublicClient,http,erc20Abi,getAddress,parseAbi,parseEventLogs} from 'viem';
import {hood,hoodCalls,simulateHoodDeposit,vaultAbi,transfer} from './robinhood-vault.mjs';
import {createHoodPaymaster} from './robinhood-paymaster.mjs';
import {planTokenDeposit,planTokenReturn} from './token-earn-policy.mjs';
import {executeTokenEarn,refreshTokenEarn,resubmitTokenEarn,repriceTokenEarn} from './token-earn-engine.mjs';
import {assertRouteState} from './routes.mjs';
import {withJournal,json} from './native-runtime.mjs';
import {quoteAuroraReturn} from './aurora-return.mjs';
import {auroraStatus} from './native-providers.mjs';
import {ceilDiv} from './native-gas.mjs';
import {readTokenPrices} from './token-prices.mjs';
const events=parseAbi(['event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)','event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)','event Transfer(address indexed from,address indexed to,uint256 value)']);
export async function hoodContext({root,env,save,paymasterFactory=createHoodPaymaster}){
 const owner=getAddress(env.DEST2_ADD),other=getAddress(env.DEST1_ADD),source=getAddress(env.SOURCE_ADD);
 if(new Set([owner,other,source]).size!==3)throw new Error('Source and destination wallets must differ');
 const routing=JSON.parse(await readFile(join(root,hood.directory,'state.json'),'utf8'));assertRouteState(routing,hood);
 assert.deepEqual(routing.recipients.map(a=>getAddress(a)),[other,owner],'Routing wallets changed');
 if(routing.payouts?.length!==2||routing.payouts.some(p=>p.status!=='delivered'))throw new Error('Both 10/90 payouts must be confirmed first');
 if(getAddress(routing.assets.destination.contractAddress)!==hood.token||routing.assets.destination.decimals!==6||routing.assets.private.decimals!==6)throw new Error('Routing assets differ from USDG/private USDC');
 const rpcUrl=env.ROBINHOOD_RPC_URL||hood.rpc;
 const client=createPublicClient({chain:hood.chain,transport:http(rpcUrl,{timeout:30000,retryCount:1}),cacheTime:0});
 if(await client.getChainId()!==4663)throw new Error('Wrong Robinhood RPC chain');
 if(getAddress(await client.readContract({address:hood.vault,abi:vaultAbi,functionName:'asset'}))!==hood.token)throw new Error('Vault asset is not USDG');
 if(await client.readContract({address:hood.token,abi:erc20Abi,functionName:'decimals'})!==6)throw new Error('USDG decimals changed');
 const aa=await paymasterFactory({client,owner,env});
 const balances=async()=>({token:await client.readContract({address:hood.token,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),shares:await client.readContract({address:hood.vault,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),native:await client.getBalance({address:owner})});
 const bindings={chainId:4663,owner,other,source,vault:hood.vault,token:hood.token,confidential:routing.confidential,privateAsset:routing.assets.private.assetId};
 async function prices(){
  const [tokenPrice,nativePrice]=await readTokenPrices({apiKey:env.AURORA_API_KEY,assetIds:[routing.assets.destination.assetId,'nep141:hood.omft.near']});
  return {tokenPrice,nativePrice};
 }
 const c={...aa,client,owner,save,bindings,balances,prices,nonce:()=>aa.account.getNonce({key:0n}),
  confirmed:async r=>(await client.getBlockNumber())>=r.receipt.blockNumber+2n,
  expired:async p=>(await client.getBlock()).timestamp+30n>=p.deadline,
  routeStatus:async route=>(await auroraStatus({apiKey:env.AURORA_API_KEY,route})).status,
  async assertFresh(plan){
   const b=await client.getBlock();if(b.timestamp>plan.block.timestamp+60n||Date.now()/1000>Number(plan.deadline)-30)throw new Error('Plan expired; re-preview');
   if((await client.getBlock({blockNumber:plan.block.number})).hash!==plan.block.hash)throw new Error('Plan reference block reorganized');
   assert.deepEqual(await balances(),plan.before,'Wallet balances changed while planning');
   const fees=(await aa.pimlico.getUserOperationGasPrice()).standard;
   if(fees.maxFeePerGas>plan.fees.maxFeePerGas||fees.maxPriorityFeePerGas>plan.fees.maxPriorityFeePerGas)throw new Error('Provider fee floor increased; re-preview');
  },
  async plan(kind,options={}){
   const before=await balances(),block=await client.getBlock(),deadline=block.timestamp+600n;
   const market=(await aa.pimlico.getUserOperationGasPrice()).standard;
   const buffered={maxFeePerGas:ceilDiv(market.maxFeePerGas*110n,100n),maxPriorityFeePerGas:ceilDiv(market.maxPriorityFeePerGas*110n,100n)};
   options={...options,feeFloor:{maxFeePerGas:options.feeFloor?.maxFeePerGas>buffered.maxFeePerGas?options.feeFloor.maxFeePerGas:buffered.maxFeePerGas,maxPriorityFeePerGas:options.feeFloor?.maxPriorityFeePerGas>buffered.maxPriorityFeePerGas?options.feeFloor.maxPriorityFeePerGas:buffered.maxPriorityFeePerGas}};
   const budget=cap=>ceilDiv(cap*105n,100n);
   if(kind==='deposit'&&before.native!==0n)throw new Error('Robinhood token-only cycle requires zero starting ETH; existing ETH needs reconciliation');
   let p;
   if(kind==='deposit'){
    if(before.shares!==0n)throw new Error('Withdraw existing shares before depositing');
    p=await planTokenDeposit({balance:before.token,estimate:async amount=>{
     const simulation=await simulateHoodDeposit({rpcUrl,anvilPath:env.ANVIL_PATH||'anvil',block,owner,amount});
     const calls=await hoodCalls({client,owner,kind,amount,deadline});
     const estimate=await aa.prepare(calls,{...options,balanceOverride:true});
     // The future withdrawal estimate sees real post-deposit vault storage.
     const withdrawal=await aa.prepare(simulation.withdrawalCalls,{...options,stateOverride:simulation.stateOverride,balanceOverride:true});
     return {calls,feeCap:budget(estimate.feeCap),quotedFeeCap:estimate.feeCap,fees:estimate.fees,withdrawalReserve:ceilDiv(withdrawal.feeCap*260n,100n),withdrawalQuoteCap:withdrawal.feeCap,simulation};
    }});
   }else if(kind==='withdraw'){
    if(before.shares<=0n)throw new Error('No shares to withdraw');
    const calls=await hoodCalls({client,owner,kind,amount:before.shares,deadline});
    const estimate=await aa.prepare(calls,options);
    if(before.token<estimate.feeCap)throw new Error('Withdrawal reserve insufficient at current fees; no operation signed');
    p={...estimate,feeCap:budget(estimate.feeCap),calls,amount:before.shares};
   }else if(kind==='return'){
    if(before.shares!==0n)throw new Error('Withdraw shares first');
    const price=await prices();
    const saved=env.ROBINHOOD_RETURN_QUOTE_FILE?JSON.parse(await readFile(env.ROBINHOOD_RETURN_QUOTE_FILE,'utf8')):undefined;
    if(saved&&saved.http!==200)throw new Error('Saved return quote was not accepted by Aurora');
    const initialAmount=saved?BigInt(saved.response.quote.amountIn):undefined;
    p=await planTokenReturn({balance:before.token,initialAmount,price:price.tokenPrice,nativeValue:ceilDiv(before.native*price.nativePrice,10n**18n),estimate:async amount=>{
     if(saved&&amount!==initialAmount)throw new Error('Saved quote leaves insufficient gas reserve; obtain another quote');
     const route=await quoteAuroraReturn({apiKey:env.AURORA_API_KEY,owner,confidential:routing.confidential,originAsset:routing.assets.destination.assetId,destinationAsset:routing.assets.private.assetId,amount,quotedResponse:saved?.response});
     if([owner,other,source].includes(getAddress(route.recipient)))throw new Error('Aurora return address links source/destination wallets');
     const calls=[transfer(route.recipient,amount)],estimate=await aa.prepare(calls,{...options,balanceOverride:true});
     return {...estimate,feeCap:budget(estimate.feeCap),calls,route};
    }});
   }else throw new Error('Unknown earn action');
   // Final operation must estimate against the real, unmodified chain state.
   const checked=await aa.prepare(p.calls,options);
   if(checked.feeCap>p.feeCap)throw new Error(`Final provider fee increased beyond budget (${checked.feeCap} > ${p.feeCap}); repeat preview`);
   if((await client.getBlock({blockNumber:block.number})).hash!==block.hash)throw new Error('Simulation reference block reorganized');
   // The final real-state estimate is fresh even if archive simulation took time.
   const quoteBlock=await client.getBlock();
   const plan={...p,op:undefined,kind,before,block:quoteBlock,simulationBlock:block,deadline:p.route?.deadline<deadline?p.route.deadline:deadline};
   await c.assertFresh(plan);return plan;
  },
  async verify(p,r){
   if(r.sender.toLowerCase()!==owner.toLowerCase())throw new Error('Receipt sender mismatch');
   const decoded=parseEventLogs({abi:events,logs:r.receipt.logs,strict:false});
   const vaultEvents=decoded.filter(e=>getAddress(e.address)===hood.vault);
   if(p.kind==='deposit'&&!vaultEvents.some(e=>e.eventName==='Deposit'&&getAddress(e.args.owner)===owner&&e.args.assets===p.amount&&e.args.shares>0n))throw new Error('Vault deposit not proven');
   if(p.kind==='withdraw'){
    const router=getAddress(p.calls.at(-1).to);
    const redemption=vaultEvents.find(e=>e.eventName==='Withdraw'&&getAddress(e.args.owner)===owner&&e.args.shares===p.amount&&[owner,router].includes(getAddress(e.args.receiver)));
    if(!redemption)throw new Error('Vault withdrawal not proven');
    // VaultBundlesV1 receives assets before forwarding them to the share owner.
    if(getAddress(redemption.args.receiver)!==owner&&!decoded.some(e=>getAddress(e.address)===hood.token&&e.eventName==='Transfer'&&getAddress(e.args.from)===router&&getAddress(e.args.to)===owner&&e.args.value===redemption.args.assets))throw new Error('Vault router did not forward redeemed USDG to wallet');
   }
   if(p.kind==='return'&&!decoded.some(e=>getAddress(e.address)===hood.token&&e.eventName==='Transfer'&&getAddress(e.args.from)===owner&&getAddress(e.args.to)===getAddress(p.route.recipient)&&e.args.value===p.amount))throw new Error('Aurora funding transfer not proven');
   if(decoded.some(e=>Object.values(e.args).some(v=>typeof v==='string'&&v.toLowerCase()===other.toLowerCase())))throw new Error('Other destination wallet appears in receipt');
   const after=await balances();if(after.native!==p.before.native)throw new Error('Unexpected ETH movement');
   if(p.kind==='deposit'&&(after.token<p.withdrawalReserve||after.shares<=p.before.shares))throw new Error('Withdrawal reserve/shares missing after deposit');
   if(p.kind==='withdraw'&&after.shares!==0n)throw new Error('Shares remain after withdrawal');
   if(p.kind==='return'&&after.token>p.reserve)throw new Error('Return remainder exceeds saved upper bound');
  },
 };
 return c;
}
export async function runRobinhood(command,arg='2',detail,{root=fileURLToPath(new URL('..',import.meta.url)),env=process.env,contextFactory=hoodContext,print=v=>console.log(json(v))}={}){
 if(arg!=='2')throw new Error('Only wallet 2 deposits into the vault');
 return withJournal(join(root,hood.directory),async journal=>{
  const c=await contextFactory({root,env,save:journal.save});let state=await journal.load();
  if(state)assert.deepEqual(state.bindings,c.bindings,'Earn state belongs to other wallets/assets');
  if(command==='preview'){if(state?.pending)throw new Error('Resolve pending operation first');const b=await c.balances();const kind=detail??(b.shares>0n?'withdraw':state?.phase==='withdrawn'?'return':'deposit');const p=await c.plan(kind);print({...p,simulation:p.simulation?{referenceBlock:p.simulation.referenceBlock,depositGas:p.simulation.depositGas,withdrawalGas:p.simulation.withdrawalGas}:undefined,note:'Unsigned preview; no funds sent. Withdrawal reserve is a stress budget, not a future fee guarantee.'});return p;}
  if(command==='earn-status'){if(state)await refreshTokenEarn(state,c);print({phase:state?.phase??'not_started',pending:state?.pending?.signed.hash,routeStatus:state?.routeStatus,residual:state?.residual,balances:await c.balances(),operations:state?.operations.map(p=>({kind:p.kind,hash:p.signed.hash,status:p.status,txHash:p.txHash}))});return state;}
  if(!state){if(command!=='deposit')throw new Error('Start with deposit');state={version:1,id:randomUUID(),bindings:c.bindings,phase:'ready',operations:[],pending:null};await journal.save(state);}
  if(command==='deposit'&&state.phase==='complete')state={version:1,id:randomUUID(),bindings:c.bindings,phase:'ready',operations:[],pending:null,history:[...(state.history??[]),{...state,history:undefined}]};
  if(command==='resubmit')await resubmitTokenEarn(state,c);else if(command==='reprice')await repriceTokenEarn(state,c);else await executeTokenEarn(state,command,c);
  print({phase:state.phase,pending:state.pending?.signed.hash,next:'Run earn-status to confirm; resubmit reuses only the saved signed operation'});return state;
 },'token-earn-2');
}
