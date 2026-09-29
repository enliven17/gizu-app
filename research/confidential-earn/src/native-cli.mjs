import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {withJournal,json} from './native-runtime.mjs';
import {createNativeContext} from './native-context.mjs';
import {executeNative,refreshNative} from './native-engine.mjs';
import {formatGwei} from 'viem';
const packageRoot=fileURLToPath(new URL('..',import.meta.url));
const feeView=fees=>fees?Object.fromEntries([['medianPriorityFeeGwei',fees.medianPriorityFee],['priorityFeeGwei',fees.priorityFee],['depositMaxFeeGwei',fees.depositFee],['withdrawalReserveFeeGwei',fees.withdrawFee]].filter(([,value])=>value!==undefined).map(([name,value])=>[name,formatGwei(value)])):undefined;
export const nativeCommands=['native-preview','native-deposit','native-withdraw','native-return','native-status','native-reprice'];
export function nativeView(state) {
 const pending=state?.pending;
 return {phase:state?.phase??'not_started',cycle:state?.id,owner:state?.bindings.owner,balances:state?.balances,
  pending:pending?.type==='fusion'?{type:'fusion',orderHash:pending.hash,inputUSDCAtoms:pending.input,minimumNativeWei:pending.minimumEth,deadline:pending.deadline}:pending?{type:'transaction',action:pending.action,kind:pending.attempts.at(-1).kind,nonce:pending.attempts[0].nonce,inclusion:pending.inclusion,hashes:pending.attempts.map(t=>t.hash)}:undefined,
  transactions:state?.transactions.map(t=>({kind:t.attempts.at(-1).kind,hash:t.winner,status:t.status})),
  orders:state?.orders.map(o=>({hash:o.hash,status:o.status})),
  returns:state?.routes.map(r=>({kind:r.kind,depositAddress:r.recipient,amount:r.request.amount,minimumUSDC:r.minimumOut,status:r.status,transactionHash:r.transactionHash})),
  next:pending?`Repeat native-${pending.action} 2 to resume; native-status 2 only checks status`:({deposit:'native-deposit 2',invested:'native-withdraw 2 when you want to exit',withdraw:'native-withdraw 2',withdrawn:'native-return 2',return:'native-return 2',return_eth:'native-return 2',awaiting_aurora:'native-status 2',route_failed:'Inspect the failed/refunded Aurora route before any new cycle',residual_exceeded:'Inspect returned funds/residual before any new cycle',complete:'Cycle complete; native-deposit 2 starts a new funded cycle'})[state?.phase]};
}
export async function runNative(command,arg,detail,{root=packageRoot,directory=join(root,'.local'),env=process.env,print=value=>console.log(json(value)),contextFactory=createNativeContext}={}) {
 if(!nativeCommands.includes(command))throw new Error('Unknown native command');
 if(arg!=='2')throw new Error('Native earn is restricted to destination wallet 2');
 return withJournal(directory,async journal=>{
  const c=await contextFactory({root,directory,env,save:journal.save});
  const prepareStep=c.prepareStep;
  c.prepareStep=async(...args)=>{
   try{const plan=await prepareStep.apply(c,args);if(command!=='native-preview'&&plan.summary)print({summary:plan.summary,feeEstimate:feeView(plan.fees)});return plan;}
   catch(error){if(error.summary)print({summary:error.summary,feeEstimate:feeView(error.fees)});throw error;}
  };
  let state=await journal.load();
  if(state){if(state.version!==1)throw new Error('Unsupported native journal version');assert.deepEqual(state.bindings,c.bindings,'Native journal belongs to different wallets/assets');}
  const balances=await c.balances();
  const makeState=phase=>({version:1,id:randomUUID(),createdAt:new Date().toISOString(),bindings:c.bindings,initialShares:state?.phase==='complete'?0n:c.initialShares??0n,phase,pending:null,transactions:[],orders:[],routes:[],balances,history:state?[...(state.history??[]),{...state,history:undefined}]:[]});
  if(command==='native-preview') {
   const action=detail??(state?.phase==='return_eth'||['withdrawn','return','awaiting_aurora'].includes(state?.phase)?'return':balances.shares>0n?'withdraw':'deposit');
   if(!['deposit','withdraw','return'].includes(action))throw new Error('Preview action must be deposit, withdraw, or return');
   if(state?.pending){print({...nativeView(state),note:'An operation is unresolved; inspect native-status before preparing another.'});return state;}
   const previewState=state??makeState(action==='return'?'return':action==='withdraw'?'withdraw':'deposit');
   const plan=await c.prepareStep(action,previewState,{preview:true});
   const publicPlan={action,summary:plan.summary,feeEstimate:feeView(plan.fees),balances,phase:previewState.phase,funding:plan.funding,gas:plan.request?.gas,feeCap:plan.request?.maxFeePerGas??plan.request?.gasPrice,kind:plan.kind,details:plan.details,amount:plan.amount,simulation:plan.simulation,referenceBlock:plan.fees?.block.number,note:'Preview only; no permit/order/transaction signed or submitted. Fusion submission will require a new estimated quote.'};
   print(publicPlan);return publicPlan;
  }
  if(command==='native-status') {if(state){await refreshNative(state,c);state.balances=await c.balances();await journal.save(state);}print(state?nativeView(state):{phase:'not_started',balances});return state;}
  const action=command==='native-reprice'?state?.pending?.action:command.slice('native-'.length);
  if(!state||(command==='native-deposit'&&state.phase==='complete')) {
   if(command==='native-reprice')throw new Error('No pending transaction to replace');
   if(command==='native-deposit'&&balances.shares!==(state?.phase==='complete'?0n:c.initialShares??0n))throw new Error('Existing share baseline changed before native deposit');
   if(command==='native-return'&&balances.shares!==0n)throw new Error('Withdraw all shares before return');
   state=makeState(action==='deposit'?'deposit':action==='withdraw'?'withdraw':'return');await journal.save(state);
  }
  await executeNative(state,action,c,{reprice:command==='native-reprice'});
  state.balances=await c.balances();await journal.save(state);print(nativeView(state));return state;
 });
}
