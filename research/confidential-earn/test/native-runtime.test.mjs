import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import * as runtime from '../src/native-runtime.mjs';

test('private journal atomically preserves integer values and excludes concurrent execution',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'earn-journal-'));
 try {
  await runtime.withJournal(dir,async j=>{
   await j.save({version:1,balance:12345678901234567890n});
   assert.equal((await j.load()).balance,12345678901234567890n);
   await assert.rejects(()=>runtime.withJournal(dir,async()=>{}),/locked/);
  });
  await runtime.withJournal(dir,async j=>assert.equal((await j.load()).version,1));
 } finally {await rm(dir,{recursive:true,force:true});}
});
test('completion requires successful routes as well as dust acceptance',()=>{
 const balances={eth:0n,usdc:0n,shares:0n};
 assert.equal(runtime.returnOutcome(balances,[{status:'SUCCESS'},{status:'PROCESSING'}],3000000000n),'awaiting_aurora');
 assert.equal(runtime.returnOutcome(balances,[{status:'SUCCESS'},{status:'REFUNDED'}],3000000000n),'route_failed');
 assert.equal(runtime.returnOutcome(balances,[],3000000000n),'awaiting_aurora');
 assert.equal(runtime.returnOutcome(balances,[{status:'SUCCESS',kind:'usdc'},{status:'SUCCESS',kind:'eth'}],3000000000n),'complete');
 assert.equal(runtime.returnOutcome({...balances,eth:10n**18n},[{status:'SUCCESS',kind:'usdc'},{status:'SUCCESS',kind:'eth'}],3000000000n),'residual_exceeded');
});
test('same-nonce recovery selects the mined winner and never creates a new nonce',async()=>{
 const attempts=[{hash:'old',nonce:7},{hash:'new',nonce:7}];
 const got=await runtime.winningAttempt(attempts,async hash=>hash==='old'?{status:'success',transactionHash:hash}:null);
 assert.equal(got.attempt.hash,'old');
 assert.equal(await runtime.winningAttempt(attempts,async()=>null),null);
});

test('stale process locks fail closed rather than racing automatic lock reclamation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'earn-stale-lock-'));
 try {await writeFile(join(dir,'native-earn-2.lock'),'2147483647');await assert.rejects(()=>runtime.withJournal(dir,async()=>assert.fail('stale lock was reclaimed')),/locked/);}
 finally {await rm(dir,{recursive:true,force:true});}
});
