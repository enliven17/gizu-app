import test from 'node:test';
import assert from 'node:assert/strict';
import {archiveCompletedVaultDeposit} from '../src/runner.mjs';

test('archives a completed deposit only after all vault shares have been withdrawn', () => {
  const prior={status:'complete',txHash:'0xprior',afterShares:'100'};
  const state={vaultDeposits:[null,prior]};
  assert.throws(()=>archiveCompletedVaultDeposit(state,1,1n),/vault shares remain/);
  assert.equal(state.vaultDeposits[1],prior);
  archiveCompletedVaultDeposit(state,1,0n);
  assert.equal(state.vaultDeposits[1],null);
  assert.deepEqual(state.vaultDepositHistory,[{wallet:2,...prior}]);
});

test('does not archive an unresolved deposit', () => {
  const prior={status:'submitted',txHash:'0xpending'};
  const state={vaultDeposits:[null,prior]};
  assert.throws(()=>archiveCompletedVaultDeposit(state,1,0n),/unresolved/);
  assert.equal(state.vaultDeposits[1],prior);
});

test('a settled deposit with excess residual can be archived only after withdrawal',()=>{
  const prior={status:'residual_exceeded',txHash:'0xsettled'};
  const state={vaultDeposits:[null,prior]};
  assert.throws(()=>archiveCompletedVaultDeposit(state,1,1n),/vault shares remain/);
  archiveCompletedVaultDeposit(state,1,0n);
  assert.equal(state.vaultDepositHistory[0].status,'residual_exceeded');
});
