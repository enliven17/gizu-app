import test from 'node:test';
import assert from 'node:assert/strict';
import {executeTokenEarn,refreshTokenEarn,repriceTokenEarn} from '../src/token-earn-engine.mjs';
import {mergeOverrides} from '../src/robinhood-paymaster.mjs';
const state=()=>({phase:'ready',operations:[],pending:null});
test('simulation overrides merge same address and slot',()=>{
 const result=mergeOverrides([{address:'0xab',stateDiff:[{slot:'0x01',value:'old'},{slot:'0x02',value:'keep'}]}],[{address:'0xAB',stateDiff:[{slot:'0x01',value:'new'}]}]);
 assert.equal(result.length,1);assert.equal(result[0].stateDiff.length,2);assert.equal(result[0].stateDiff[0].value,'new');
});
test('save precedes broadcast; uncertain submission cannot sign another operation',async()=>{
 const s=state(),events=[];const c={plan:async()=>({kind:'deposit',calls:[],feeCap:100n}),assertFresh:async()=>{},authorize:async()=>{},prepare:async()=>({feeCap:90n,op:{}}),sign:async()=>{events.push('sign');return {hash:'hash'};},save:async()=>events.push('save'),submit:async()=>{events.push('submit');throw Error('timeout');},receipt:async()=>null};
 await assert.rejects(executeTokenEarn(s,'deposit',c),/saved/);assert.deepEqual(events,['sign','save','submit','save']);
 await assert.rejects(executeTokenEarn(s,'deposit',c),/unresolved/);assert.equal(events.filter(x=>x==='sign').length,1);
});
test('temporary price failure stays retryable after Aurora succeeds',async()=>{
 const s={phase:'awaiting_aurora',route:{},pending:null};const c={routeStatus:async()=>'SUCCESS',balances:async()=>({shares:0n,token:10n,native:0n}),prices:async()=>{throw Error('offline');},save:async()=>{}};
 await assert.rejects(refreshTokenEarn(s,c),/offline/);assert.equal(s.phase,'awaiting_aurora');
});
test('replacement retains old attempt and uses same nonce with fee bump',async()=>{
 const old={kind:'return',signed:{hash:'old',rpcOperation:{nonce:'0x3',maxFeePerGas:'0x64',maxPriorityFeePerGas:'0xa'}}};const s={phase:'withdrawn',pending:old,operations:[]};let supplied;
 const c={receipt:async()=>null,nonce:async()=>3n,plan:async(kind,options)=>{supplied=options;return {kind,calls:[],feeCap:100n};},assertFresh:async()=>{},authorize:async()=>{},prepare:async(_calls,options)=>({feeCap:90n,op:{nonce:options.nonce}}),sign:async op=>({hash:'new',rpcOperation:{nonce:String(op.nonce)}}),save:async()=>{},submit:async()=>{}};
 await repriceTokenEarn(s,c);assert.equal(supplied.nonce,3n);assert.equal(supplied.feeFloor.maxFeePerGas,113n);assert.equal(s.pending.attempts[0].signed.hash,'old');
});
test('older replacement winner retains its own Aurora route',async()=>{
 const old={kind:'return',route:{recipient:'older'},signed:{hash:'old'}};
 const s={phase:'withdrawn',operations:[],pending:{kind:'return',route:{recipient:'newer'},signed:{hash:'new'},attempts:[old]}};
 const c={receipt:async h=>h==='old'?{success:true,receipt:{transactionHash:'tx'}}:null,confirmed:async()=>true,verify:async p=>assert.equal(p.route.recipient,'older'),save:async()=>{},routeStatus:async()=>'PROCESSING'};
 await refreshTokenEarn(s,c);assert.equal(s.pending,null);assert.equal(s.route.recipient,'older');assert.equal(s.phase,'awaiting_aurora');
});
test('mined failed withdrawal preserves evidence and allows fresh withdrawal',async()=>{
 const s={phase:'invested',operations:[],pending:{kind:'withdraw',signed:{hash:'failed'}}};
 await refreshTokenEarn(s,{receipt:async()=>({success:false}),confirmed:async()=>true,save:async()=>{}});
 assert.equal(s.phase,'invested');assert.equal(s.pending,null);assert.equal(s.operations[0].status,'failed');
});
