import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,access,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {runNative} from '../src/native-cli.mjs';
import {prepareNativeStep} from '../src/native-planner.mjs';
test('deposit preview and execution disclose costs before any Fusion authorization; unaffordable preview still explains the budget',async()=>{
 for(const command of ['native-preview','native-deposit','unaffordable']){
  const root=await mkdtemp(join(tmpdir(),'earn-costs-')),printed=[];
  try{
   const factory=async({save})=>{
    const c={save,bindings:{owner:'owner'},balances:async()=>({eth:0n,usdc:command==='unaffordable'?1000000n:10000000n,shares:0n,weth:0n}),fees:async()=>({block:{number:1n,timestamp:10n},medianPriorityFee:360000000n,priorityFee:240000000n,depositFee:1365000000n,withdrawFee:2730000000n}),latestNonce:async()=>0,price:async()=>2000000000n,simulate:async()=>({budget:{totalWei:1000000000000000n}}),quoteFusion:async input=>({input,minimumEth:input*1000000000n}),assertFresh:async()=>{},prepareFusion:async()=>{assert.equal(printed[0].summary.depositUSDC,'7.95');throw new Error('stop before signing');},signTransaction:()=>assert.fail('signed'),broadcast:()=>assert.fail('broadcast')};
    c.prepareStep=(action,state,options)=>prepareNativeStep(action,state,c,options);return c;
   };
   const run=()=>runNative(command==='unaffordable'?'native-preview':command,'2','deposit',{root,contextFactory:factory,print:value=>printed.push(value)});
   if(command==='native-deposit')await assert.rejects(run,/stop before signing/);
   else if(command==='unaffordable')await assert.rejects(run,/Insufficient affordable/);
   else{const result=await run();assert.equal(result.summary.depositUSDC,'7.95');assert.equal(result.feeEstimate.priorityFeeGwei,'0.24');}
   assert.equal(printed[0].summary.initialUSDC,command==='unaffordable'?'1':'10');
   if(command==='unaffordable'){assert.equal(printed[0].summary.depositUSDC,'0');assert.equal(printed[0].feeEstimate.priorityFeeGwei,'0.24');}
  }finally{await rm(root,{recursive:true,force:true});}
 }
});
test('preview performs no signing/submission or persistent cycle creation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'earn-preview-'));
 try {
  const c={bindings:{owner:'owner'},balances:async()=>({eth:0n,usdc:1000000n,shares:0n}),prepareStep:async(action,_state,options)=>{assert.equal(action,'deposit');assert.equal(options.preview,true);return {amount:950000n};},signTransaction:()=>assert.fail('preview signed'),prepareFusion:()=>assert.fail('preview authorized'),broadcast:()=>assert.fail('preview sent')};
  const result=await runNative('native-preview','2','deposit',{root,contextFactory:async()=>c,print:()=>{}});
  assert.equal(result.amount,950000n);await assert.rejects(()=>access(join(root,'.local/native-earn-2.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('wallet 1 cannot reach native context or signing',async()=>{
 await assert.rejects(()=>runNative('native-deposit','1',undefined,{contextFactory:()=>assert.fail('wrong-wallet context')}),/wallet 2/);
});
test('profile-native context and journal use route directory, preserving legacy journal',async()=>{
 const root=await mkdtemp(join(tmpdir(),'earn-route-')),directory=join(root,'.local/ethereum');let seen;
 try{
  const c={bindings:{owner:'owner'},balances:async()=>({eth:0n,usdc:1000000n,shares:0n}),prepareStep:async()=>({amount:1n})};
  await runNative('native-preview','2','deposit',{root,directory,contextFactory:async args=>{seen=args.directory;return c;},print:()=>{}});
  assert.equal(seen,directory);await assert.rejects(access(join(root,'.local/native-earn-2.json')),{code:'ENOENT'});
 }finally{await rm(root,{recursive:true,force:true});}
});
test('first deposit records the approved existing shares before any funding and rejects an unrecorded change',async()=>{
 const root=await mkdtemp(join(tmpdir(),'earn-existing-'));
 try{
  const factory=async({save})=>({initialShares:7n,bindings:{owner:'owner'},save,balances:async()=>({eth:0n,usdc:1000000n,shares:7n}),prepareStep:async(_action,s)=>{assert.equal(s.initialShares,7n);throw new Error('stop before sending');}});
  await assert.rejects(runNative('native-deposit','2',undefined,{root,contextFactory:factory,print:()=>{}}),/stop before sending/);
  assert.equal(JSON.parse(await readFile(join(root,'.local/native-earn-2.json'),'utf8')).initialShares.$nativeInteger,'7');
 }finally{await rm(root,{recursive:true,force:true});}
 const fresh=await mkdtemp(join(tmpdir(),'earn-changed-'));
 try{await assert.rejects(runNative('native-deposit','2',undefined,{root:fresh,contextFactory:async()=>({initialShares:6n,bindings:{owner:'owner'},balances:async()=>({eth:0n,usdc:1000000n,shares:7n})}),print:()=>{}}),/changed|baseline/i);}finally{await rm(fresh,{recursive:true,force:true});}
});
