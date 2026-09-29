import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveEthereumBundler, resolveEthereumEstimator, vaultPreparationRequest, applyVerificationGasFloor} from '../src/vault-deposit.mjs';

test('Ethereum relay choice is limited to known EntryPoint v0.8 bundlers', () => {
  assert.deepEqual(resolveEthereumBundler(),{id:'pimlico',url:'https://public.pimlico.io/v2/1/rpc'});
  assert.deepEqual(resolveEthereumBundler('candide'),{id:'candide',url:'https://api.candide.dev/public/v3/1'});
  assert.throws(()=>resolveEthereumBundler('https://example.com'),/Unknown Ethereum bundler/);
});

test('Candide relay uses the proven Pimlico gas estimator for Circle permit operations', () => {
  assert.deepEqual(resolveEthereumEstimator('candide'),resolveEthereumBundler('pimlico'));
  assert.deepEqual(resolveEthereumEstimator('pimlico'),resolveEthereumBundler('pimlico'));
});

test('a replacement explicitly reuses the saved UserOperation nonce', () => {
  const account={address:'0x0000000000000000000000000000000000000001'};
  const calls=[{to:account.address,data:'0x',value:0n}];
  const savedNonce=33031480248171897111531470454784n;
  assert.deepEqual(vaultPreparationRequest({account,calls,nonce:savedNonce}),{account,calls,nonce:savedNonce});
  assert.deepEqual(vaultPreparationRequest({account,calls}),{account,calls});
});

test('a relay verification floor raises only the prepared verification limit', () => {
  const prepared={verificationGasLimit:51_698n,callGasLimit:857_686n};
  assert.deepEqual(applyVerificationGasFloor(prepared,165_395n),{...prepared,verificationGasLimit:165_395n});
  assert.deepEqual(applyVerificationGasFloor(prepared,40_000n),prepared);
});
