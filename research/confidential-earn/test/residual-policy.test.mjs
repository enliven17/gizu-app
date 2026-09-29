import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {circleResidualBound,assertCircleResidualBound,settledVaultStatus,refreshStoredResidualStatus} from '../src/residual-policy.mjs';
import {signVaultDeposit,submitVaultDeposit} from '../src/vault-deposit.mjs';

test('both historical transactions fail the residual criterion despite successful deposits',async()=>{
  for(const label of ['first','candide']) {
    const result=JSON.parse(await readFile(new URL(`../fixtures/${label}-replay-result.json`,import.meta.url),'utf8'));
    const balance=BigInt(result.before.usdc),amount=BigInt(result.deposit);
    assert.equal(settledVaultStatus(BigInt(result.after.usdc)),'residual_exceeded');
    assert.throws(()=>assertCircleResidualBound({balance,amount}),/residual bound/);
  }
});

test('acceptance is strict at 0.5 and optimality is strict at 0.1',()=>{
  for(const [residual,status] of [[0n,'complete'],[99_999n,'complete'],[100_000n,'complete'],[499_999n,'complete'],[500_000n,'residual_exceeded'],[1_731_762n,'residual_exceeded']]) {
    assert.equal(settledVaultStatus(residual),status);
    const result=circleResidualBound({balance:2_000_000n,amount:2_000_000n-residual});
    assert.equal(result.accepted,residual<500_000n);
    assert.equal(result.optimal,residual<100_000n);
  }
});

test('bound covers every nonnegative final charge, including a cheaper execution than the simulation',()=>{
  const plan={balance:3_592_555n,amount:3_192_556n};
  const bound=assertCircleResidualBound(plan);
  for(const charge of [0n,1n,100_000n,399_999n]) assert(plan.balance-plan.amount-charge<=bound.maximumResidualAtoms);
  // A projected 0.34 refund does not certify a 1.4-USDC reserve.
  assert.throws(()=>assertCircleResidualBound({balance:1_731_762n,amount:331_762n,projectedRefund:340_000n}),/residual bound/);
});

test('invalid accounting and negative settled balances fail closed',()=>{
  for(const plan of [{balance:1n,amount:0n},{balance:1n,amount:2n},{balance:-1n,amount:1n}]) assert.throws(()=>circleResidualBound(plan));
  assert.throws(()=>settledVaultStatus(-1n));
});

test('unsafe and legacy plans cannot reach signing or the relay',async()=>{
  // No RPC client or signer exists in these contexts: rejection must precede either.
  await assert.rejects(signVaultDeposit({balance:3_592_555n},{},{amount:134_142n}),/residual bound/);
  await assert.rejects(signVaultDeposit({balance:3_592_555n},{}),/Invalid residual accounting/);
  await assert.rejects(submitVaultDeposit({rpcOperation:{}}),/no residual bound/);
  await assert.rejects(submitVaultDeposit({beforeBalanceAtoms:'3592555',depositAtoms:'134142'}),/residual bound/);
});

test('a changed balance is rejected before the account signature',async()=>{
  const context={balance:2_000_000n,feeBlockNumber:1n,token:'0xtoken',owner:{address:'0xowner'},
    client:{getBlockNumber:async()=>1n,readContract:async()=>2_600_000n}};
  await assert.rejects(signVaultDeposit(context,{},{amount:1_900_000n}),/balance changed/);
});

test('legacy completed records cannot keep reporting a known failed residual as completed',()=>{
  const state={phase:'completed',vaultDeposits:[null,{status:'complete',afterBalanceAtoms:'1731762',txHash:'0xhistorical'}]};
  refreshStoredResidualStatus(state);
  assert.equal(state.phase,'residual_exceeded');
  assert.equal(state.vaultDeposits[1].status,'residual_exceeded');
  assert.equal(state.vaultDeposits[1].txHash,'0xhistorical');
  const pending={phase:'vaults_pending',vaultDeposits:[null,{status:'submitted'}]};
  refreshStoredResidualStatus(pending);
  assert.equal(pending.vaultDeposits[1].status,'submitted');
});
