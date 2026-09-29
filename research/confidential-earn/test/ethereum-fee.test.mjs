import test from 'node:test';
import assert from 'node:assert/strict';
import {assertBidBlock, assertBundlerFeeFloor, bidForRetry, bundlerMinimumFromError, bundlerVerificationFloorFromError, nextBlockBaseFee, nextBlockBid, priorityFromFeeHistory, promoteWinningAttempt, replacementBid} from '../src/ethereum-fee.mjs';

test('derives the exact next Ethereum base fee from a block below target', () => {
  assert.equal(nextBlockBaseFee({baseFeePerGas:891_124_816n,gasUsed:26_679_186n,gasLimit:60_000_000n}),878_794_567n);
});

test('derives the exact next Ethereum base fee at and above target', () => {
  assert.equal(nextBlockBaseFee({baseFeePerGas:800n,gasUsed:30n,gasLimit:60n}),800n);
  assert.equal(nextBlockBaseFee({baseFeePerGas:800n,gasUsed:60n,gasLimit:60n}),900n);
  assert.equal(nextBlockBaseFee({baseFeePerGas:1n,gasUsed:60n,gasLimit:60n}),2n);
});

test('bids for the next block with the live priority fee', () => {
  assert.deepEqual(nextBlockBid({baseFeePerGas:891_124_816n,gasUsed:26_679_186n,gasLimit:60_000_000n},1_095_623_089n),
    {maxFeePerGas:1_974_417_656n,maxPriorityFeePerGas:1_095_623_089n});
  assert.throws(()=>nextBlockBid({baseFeePerGas:891_124_816n,gasUsed:26_679_186n,gasLimit:60_000_000n},0n),/priority/);
});

test('uses the median recent 20th-percentile included tip, with a small floor', () => {
  assert.equal(priorityFromFeeHistory({reward:[[1n],[10_000n],[100_000_000n],[10_000_000n],[10_000_000n]]}),10_000_000n);
  assert.equal(priorityFromFeeHistory({reward:[[1n],[2n],[3n]]}),10_000n);
  assert.throws(()=>priorityFromFeeHistory({reward:[]}),/priority history/);
});

test('refuses a market bid below the live bundler floor before signing', () => {
  const floor={maxFeePerGas:2_281_635_853n,maxPriorityFeePerGas:1_350_045_001n};
  assert.throws(()=>assertBundlerFeeFloor({maxFeePerGas:1_045_465_624n,maxPriorityFeePerGas:87_204_332n},floor),/2281635853/);
  assert.doesNotThrow(()=>assertBundlerFeeFloor(floor,floor));
});

test('recognizes Pimlico fee rejection without exposing the signed operation', () => {
  assert.equal(bundlerMinimumFromError({details:'maxFeePerGas must be at least 2281635853 (current maxFeePerGas: 1045465624)'}),2_281_635_853n);
  assert.equal(bundlerMinimumFromError({details:'some other RPC failure'}),null);
});

test('derives Candide verification gas floor from its measured submission deficit', () => {
  assert.equal(bundlerVerificationFloorFromError({details:'verificationGas should have extra 2000 gas. has only -106697'},51_698n),165_395n);
  assert.equal(bundlerVerificationFloorFromError({details:'some other RPC failure'},51_698n),null);
});

test('refuses to sign a next-block bid after its reference block changes', () => {
  assert.doesNotThrow(()=>assertBidBlock(26_075_996n,26_075_996n));
  assert.throws(()=>assertBidBlock(26_075_996n,26_075_997n),/stale/);
});

test('replaces a pending bid only when both fees clear the bundler bump without extra cap slack', () => {
  assert.deepEqual(replacementBid({maxFeePerGas:1_100n,maxPriorityFeePerGas:100n},{maxFeePerGas:1_000n,maxPriorityFeePerGas:100n}),
    {maxFeePerGas:1_110n,maxPriorityFeePerGas:110n});
  assert.throws(()=>replacementBid({maxFeePerGas:950n,maxPriorityFeePerGas:100n},{maxFeePerGas:1_000n,maxPriorityFeePerGas:100n}),/cannot replace/);
});

test('a rejected operation can retry with the current market bid at the same nonce', () => {
  const next={maxFeePerGas:900n,maxPriorityFeePerGas:50n};
  const prior={maxFeePerGas:1_000n,maxPriorityFeePerGas:100n};
  assert.deepEqual(bidForRetry(next,prior,'rejected_by_bundler'),next);
  assert.throws(()=>bidForRetry(next,prior,'submitted'),/cannot replace/);
});

test('promotes an older winning attempt without duplicating its receipt in history', () => {
  const older={signed:{userOperationHash:'0xold'},amountAtoms:'1'};
  const current={signed:{userOperationHash:'0xnew'},amountAtoms:'2',attempts:[older]};
  const promoted=promoteWinningAttempt(current,older);
  assert.equal(promoted.signed.userOperationHash,'0xold');
  assert.deepEqual(promoted.attempts.map(a=>a.signed.userOperationHash),['0xnew']);
  assert.equal(promoteWinningAttempt(promoted,promoted),promoted);
});
