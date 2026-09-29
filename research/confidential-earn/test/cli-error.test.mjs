import test from 'node:test';
import assert from 'node:assert/strict';
import {safeCliError} from '../src/cli-error.mjs';

test('prints a provider failure without replayable operation fields', () => {
  const error={shortMessage:'The Paymaster reverted.',details:'AA33 reverted: ERC20: transfer amount exceeds allowance',message:'The Paymaster reverted.\n\nRequest Arguments:\n  paymasterData: 0xabcdefabcdefabcdef\n  signature: 0x1234567890abcdef\nDetails: AA33 reverted'};
  assert.equal(safeCliError(error),'The Paymaster reverted. AA33 reverted: ERC20: transfer amount exceeds allowance');
});

test('redacts long hex values in provider details', () => {
  assert.equal(safeCliError({shortMessage:'Rejected',details:'signature 0x1234567890abcdef'}),'Rejected signature [REDACTED_HEX]');
});
