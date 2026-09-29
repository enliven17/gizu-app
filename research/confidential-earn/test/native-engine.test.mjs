import test from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/native-engine.mjs';
const balances={usdc:1000000n,eth:1000000000000000n,shares:0n,weth:0n};
function fixture(){
 let saved;const events=[];
 const io={save:async s=>{saved=structuredClone(s);events.push('save');},balances:async()=>balances,
  receipt:async()=>null,latestNonce:async()=>0,pendingNonce:async()=>0,
  prepareStep:async()=>({kind:'deposit',request:{nonce:0},before:balances}),
  signTransaction:async()=>({hash:'hash',raw:'raw'}),broadcast:async()=>{events.push('broadcast');throw new Error('network timeout');},
  fees:async()=>({}),price:async()=>3000000000n};
 const state={phase:'deposit',pending:null,transactions:[],orders:[],routes:[]};
 return {io,state,events,saved:()=>saved};
}
test('transaction is persisted before broadcast and uncertainty never signs a replacement',async()=>{
 const f=fixture();await assert.rejects(()=>engine.executeNative(f.state,'deposit',f.io),/timeout/);
 assert.deepEqual(f.events,['save','broadcast']);assert.equal(f.saved().pending.attempts[0].raw,'raw');
 let signed=0;f.io.signTransaction=async()=>{signed++;throw new Error('must not sign');};
 f.io.broadcast=async()=>{};
 await engine.executeNative(f.saved(),'deposit',f.io);assert.equal(signed,0);
});
test('wrong command cannot advance an unresolved operation from another stage',async()=>{
 const f=fixture();f.state.pending={type:'transaction',action:'withdraw',attempts:[{hash:'h',nonce:0}]};
 await assert.rejects(()=>engine.executeNative(f.state,'deposit',f.io),/pending|stage/);
});
test('unmined consumed nonce fails closed, without blind re-signing',async()=>{
 const f=fixture();f.state.pending={type:'transaction',action:'deposit',attempts:[{hash:'h',nonce:0}]};f.io.latestNonce=async()=>1;
 await assert.rejects(()=>engine.executeNative(f.state,'deposit',f.io),/nonce/);
});
test('a mined older replacement wins and binds its actual Aurora route',async()=>{
 const f=fixture();
 const old={hash:'old',nonce:0,kind:'return_eth',route:{recipient:'old-address',request:{amount:'4'}}};
 f.state.phase='return_eth';f.state.pending={type:'transaction',action:'return',attempts:[old,{...old,hash:'new',route:{recipient:'new-address'}}]};
 f.io.receipt=async hash=>hash==='old'?{status:'success',blockNumber:10n,gasUsed:21000n,effectiveGasPrice:1n}:null;
 f.io.verifyTransaction=async()=>({eth:0n,usdc:0n,shares:0n});f.io.auroraStatus=async()=>({status:'PROCESSING'});
 await engine.refreshNative(f.state,f.io);
 assert.equal(f.state.transactions[0].winner,'old');assert.equal(f.state.routes[0].recipient,'old-address');assert.equal(f.state.phase,'awaiting_aurora');
});
test('Fusion payload is saved before provider submission; pending order is not signed again',async()=>{
 const f=fixture();f.io.prepareStep=async()=>({funding:{input:12n,requiredEth:8n}});f.io.prepareFusion=async()=>({hash:'order',payload:{quoteId:'q'}});
 f.io.submitFusion=async()=>{f.events.push('submit');throw new Error('uncertain');};
 await assert.rejects(()=>engine.executeNative(f.state,'deposit',f.io),/uncertain/);assert.deepEqual(f.events,['save','submit']);
 const state=f.saved();assert.equal(state.pending.type,'fusion');f.io.reconcileFusion=async()=>({status:'unknown'});f.io.prepareFusion=()=>assert.fail('must retain existing order');
 await engine.executeNative(state,'deposit',f.io);assert.equal(state.pending.hash,'order');
});
test('mined operations awaiting confirmation are neither rebroadcast nor replaced',async()=>{
 const f=fixture();f.state.pending={type:'transaction',action:'deposit',attempts:[{hash:'h',nonce:0}]};
 f.io.receipt=async()=>({status:'success',blockNumber:12n});f.io.confirmed=async()=>false;
 f.io.broadcast=()=>assert.fail('mined transaction must not be rebroadcast');
 f.io.prepareStep=()=>assert.fail('mined transaction must not be replaced');
 await engine.executeNative(f.state,'deposit',f.io);
 await engine.executeNative(f.state,'deposit',f.io,{reprice:true});
});
