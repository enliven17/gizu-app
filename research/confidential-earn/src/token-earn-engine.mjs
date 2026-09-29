import assert from 'node:assert/strict';
import {assertFinalResidual} from './token-earn-policy.mjs';
import {safeCliError} from './cli-error.mjs';
import {ceilDiv} from './native-gas.mjs';
export async function refreshTokenEarn(state,c){
 if(state.pending){
  let pending,receipt;
  for(const candidate of [...(state.pending.attempts??[]),state.pending]){const r=await c.receipt(candidate.signed.hash);if(r){pending=candidate;receipt=r;break;}}
  if(!receipt)return;
  if(!await c.confirmed(receipt))return;
  if(!receipt.success){pending.status='failed';state.operations.push(pending);state.pending=null;state.phase={deposit:'ready',withdraw:'invested',return:'withdrawn'}[pending.kind];await c.save(state);return;}
  await c.verify(pending,receipt);
  pending.txHash=receipt.receipt.transactionHash;pending.status='confirmed';
  state.operations.push(pending);state.pending=null;
  state.phase={deposit:'invested',withdraw:'withdrawn',return:'awaiting_aurora'}[pending.kind];
  if(pending.route)state.route=pending.route;
  await c.save(state);
 }
 if(state.phase==='awaiting_aurora'){
  state.routeStatus=await c.routeStatus(state.route);
  if(state.routeStatus==='SUCCESS'){
   const b=await c.balances();if(b.shares!==0n)throw new Error('Shares remain after return');
   const prices=await c.prices();
   try{state.residual=assertFinalResidual({...b,...prices});state.phase='complete';}catch{state.phase='residual_exceeded';}
  }else if(['FAILED','REFUNDED'].includes(state.routeStatus))state.phase='route_failed';
  await c.save(state);
 }
}
export async function executeTokenEarn(state,kind,c){
 await refreshTokenEarn(state,c);
 if(state.pending)throw new Error('Saved UserOperation unresolved; use earn-status or resubmit, not another signature');
 const expected={deposit:['ready'],withdraw:['invested'],return:['withdrawn']};
 if(!expected[kind]?.includes(state.phase))throw new Error(`Cannot ${kind} in ${state.phase}`);
 const plan=await c.plan(kind);
 await c.assertFresh(plan);
 const authorization=await c.authorize();
 const final=await c.prepare(plan.calls,{authorization,sponsor:true,feeFloor:plan.fees});
 if(final.feeCap>plan.feeCap)throw new Error('Fresh paymaster cap increased; re-preview before signing');
 await c.assertFresh(plan);
 const signed=await c.sign(final.op);
 state.pending={...plan,signed,createdAt:new Date().toISOString(),status:'signed'};
 // Never store ephemeral simulation state overrides in the live journal.
 delete state.pending.simulation;
 await c.save(state);
 try{await c.submit(signed);state.pending.status='submitted';await c.save(state);}catch(error){state.pending.submissionError=safeCliError(error);await c.save(state);throw new Error(`Submission outcome unknown/rejected; signed operation saved. Run earn-status before resubmit. ${state.pending.submissionError}`);}
}
export async function resubmitTokenEarn(state,c){
 await refreshTokenEarn(state,c);
 if(!state.pending)throw new Error('No pending UserOperation');
 const p=state.pending;
 if(await c.receipt(p.signed.hash))throw new Error('Operation mined; wait for confirmation');
 assert.equal(await c.nonce(),BigInt(p.signed.rpcOperation.nonce),'Account nonce changed; inspect before resubmitting');
 if(await c.expired(p))throw new Error('Saved operation/route expired; do not fund its old address');
 await c.submit(p.signed);p.status='submitted';await c.save(state);
}
export async function repriceTokenEarn(state,c){
 await refreshTokenEarn(state,c);
 const previous=state.pending;if(!previous)throw new Error('No unresolved operation to replace');
 for(const p of [...(previous.attempts??[]),previous])if(await c.receipt(p.signed.hash))throw new Error('Operation mined; wait for confirmation');
 const nonce=BigInt(previous.signed.rpcOperation.nonce);
 assert.equal(await c.nonce(),nonce,'Account nonce changed; inspect before replacement');
 const feeFloor={maxFeePerGas:ceilDiv(BigInt(previous.signed.rpcOperation.maxFeePerGas)*1125n,1000n),maxPriorityFeePerGas:ceilDiv(BigInt(previous.signed.rpcOperation.maxPriorityFeePerGas)*1125n,1000n)};
 const plan=await c.plan(previous.kind,{nonce,feeFloor});await c.assertFresh(plan);
 const authorization=await c.authorize();
 const final=await c.prepare(plan.calls,{nonce,feeFloor:plan.fees??feeFloor,authorization,sponsor:true});
 if(final.op.nonce!==nonce||final.feeCap>plan.feeCap)throw new Error('Replacement nonce or fee cap changed');
 await c.assertFresh(plan);const signed=await c.sign(final.op);
 state.pending={...plan,signed,status:'signed',attempts:[...(previous.attempts??[]),{...previous,attempts:undefined}]};delete state.pending.simulation;
 await c.save(state);
 try{await c.submit(signed);state.pending.status='submitted';await c.save(state);}catch(error){state.pending.submissionError=safeCliError(error);await c.save(state);throw new Error(`Replacement outcome unknown/rejected; run earn-status before resubmit. ${state.pending.submissionError}`);}
}
