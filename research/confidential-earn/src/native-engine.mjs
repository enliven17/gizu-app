import {winningAttempt,returnOutcome} from './native-runtime.mjs';
const nextPhase={approve_deposit:'deposit',deposit:'invested',approve_withdraw:'withdraw',withdraw:'withdrawn',return_usdc:'return_eth',return_eth:'awaiting_aurora'};
export async function refreshNative(state,io) {
 const pending=state.pending;
 if(pending?.type==='transaction') {
  const winner=await winningAttempt(pending.attempts,io.receipt);
  if(winner) {
   if(io.confirmed&&!await io.confirmed(winner.receipt)){pending.inclusion={hash:winner.attempt.hash,blockNumber:winner.receipt.blockNumber};return state;}
   if(winner.receipt.status!=='success') {
    state.transactions.push({...pending,winner:winner.attempt.hash,status:'reverted'});state.pending=null;
    await io.save(state);throw new Error('Saved transaction reverted; inspect status and re-plan with the same stage command');
   }
   const after=await io.verifyTransaction(winner.attempt,winner.receipt);
   if(winner.attempt.route)state.routes.push({...winner.attempt.route,kind:winner.attempt.kind==='return_eth'?'eth':'usdc',transactionHash:winner.attempt.hash,status:'PENDING_DEPOSIT'});
   state.transactions.push({...pending,winner:winner.attempt.hash,receipt:{blockNumber:winner.receipt.blockNumber,gasUsed:winner.receipt.gasUsed,effectiveGasPrice:winner.receipt.effectiveGasPrice},after,status:'confirmed'});
   state.phase=nextPhase[winner.attempt.kind];state.pending=null;await io.save(state);
  } else {delete pending.inclusion;if(await io.latestNonce()>pending.attempts[0].nonce)throw new Error('Wallet nonce consumed by an unrecognized transaction; reconcile before proceeding');}
 } else if(pending?.type==='fusion') {
  const outcome=await io.reconcileFusion(pending);
  if(outcome.status==='filled'||outcome.status==='expired') {
   state.orders.push({...pending,...outcome});state.pending=null;await io.save(state);
  }
 }
 if(!state.pending&&['awaiting_aurora','route_failed','residual_exceeded','complete'].includes(state.phase)) {
  for(const route of state.routes)Object.assign(route,await io.auroraStatus(route));
  state.balances=await io.balances();state.phase=returnOutcome(state.balances,state.routes,await io.price());await io.save(state);
 }
 return state;
}
export async function executeNative(state,action,io,{reprice=false}={}) {
 if(state.pending&&action!==state.pending.action)throw new Error(`A ${state.pending.action} operation is pending; resolve that stage first`);
 await refreshNative(state,io);
 if(state.pending) {
  if(state.pending.type==='fusion'||state.pending.inclusion)return state;
  const old=state.pending.attempts.at(-1);
  if(!reprice){if(!io.canRebroadcast||await io.canRebroadcast(old))await io.broadcast(old.raw);return state;}
  if(await io.latestNonce()!==old.nonce)throw new Error('Cannot replace an operation with a changed wallet nonce');
  const replacement=await io.prepareStep(action,state,{replace:old});
  if(replacement.funding||replacement.done)throw new Error('Replacement cannot change the pending transaction into a funding order');
  if(replacement.kind!==old.kind||replacement.request.nonce!==old.nonce)throw new Error('Replacement changed transaction purpose or nonce');
  const signed=await io.signTransaction(replacement.request);
  const attempt={...replacement,...signed,nonce:replacement.request.nonce};
  state.pending.attempts.push(attempt);await io.save(state);await io.broadcast(signed.raw);return state;
 }
 if(reprice)throw new Error('No unresolved transaction to replace');
 const allowed={deposit:['deposit','invested'],withdraw:['invested','withdraw','withdrawn'],return:['withdrawn','return','return_eth','awaiting_aurora','complete']};
 if(!allowed[action]?.includes(state.phase))throw new Error(`Cannot ${action} during phase ${state.phase}`);
 if((action==='deposit'&&state.phase==='invested')||(action==='withdraw'&&state.phase==='withdrawn')||['awaiting_aurora','complete'].includes(state.phase))return state;
 const step=await io.prepareStep(action,state,{});
 if(step.done){state.phase=step.phase;await io.save(state);return state;}
 if(step.funding) {
  const order=await io.prepareFusion(step.funding);
  state.pending={...order,type:'fusion',action};await io.save(state);
  await io.submitFusion(order.payload);return state;
 }
 if(await io.pendingNonce()!==await io.latestNonce())throw new Error('Wallet has an external pending transaction; no new nonce will be signed');
 const signed=await io.signTransaction(step.request);
 state.pending={type:'transaction',action,attempts:[{...step,...signed,nonce:step.request.nonce}]};
 await io.save(state);await io.broadcast(signed.raw);return state;
}
