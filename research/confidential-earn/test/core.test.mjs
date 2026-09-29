import test from 'node:test';
import assert from 'node:assert/strict';
import {base58} from '@scure/base';
import {encodeFunctionData, erc20Abi} from 'viem';
import * as core from '../src/core.mjs';
import {splitSourceBudget, validatePreparedIntent, encodeAuroraSignature, chooseConfidentialAsset} from '../src/core.mjs';
import {fundingAmount, prepareMonadFunding, signedErc20FeeCap, sourceBudget} from '../src/source-paymaster.mjs';
import {circleFeeCap, circleFinalCharge, assertVaultDepositPlan} from '../src/vault-deposit.mjs';

test('splits confirmed private balance 10/90 without losing atoms', () => {
  const amounts = splitSourceBudget(9_875_001n);
  assert.deepEqual(amounts, [987_500n, 8_887_501n]);
  assert.equal(amounts.reduce((a, b) => a + b), 9_875_001n);
  assert.deepEqual(splitSourceBudget(10n), [1n, 9n]);
  assert.throws(() => splitSourceBudget(9n), /both recipients/);
});

test('source budget uses available USDC up to the 10 USDC cap', () => {
  assert.equal(sourceBudget(9_807_581n),9_807_581n);
  assert.equal(sourceBudget(12_000_000n),10_000_000n);
  assert.throws(() => sourceBudget(0n),/no USDC/);
});

test('source USDC transfer subtracts only the quoted paymaster fee from the available budget', () => {
  assert.equal(fundingAmount(10_000_000n, 23_702n), 9_976_298n);
  assert.equal(fundingAmount(9_807_581n, 23_702n), 9_783_879n);
  assert.equal(fundingAmount(10_000_000n, 23_702n, 10_000n), 9_966_298n);
  assert.throws(() => fundingAmount(9_807_581n, 9_807_581n), /fee consumes/);
  assert.throws(() => fundingAmount(10_000n, 1n, 10_000n), /fee consumes/);
});

test('source fee cap comes from the signed mainnet paymaster data', async () => {
  const paymasterData='0x020000006ab68777000000000000754704bc059f8c67012fed69bc8a327a5aafb6030000000000000000000000000000907e0000000000000000000000000000000000000000000000000000000000006db300000000000000000000000000012b5fd8baa107006c93a030d1455a2ef43261b384f21cf93982eb796e157a62533b16bbaa83939855d16a9c1d28bb320f0035fceca56631936f8f7d63efdf5e5d55bd1a78fa2f337e0e72240cb026889f40a6e43a29541b';
  const operation={paymasterData,callGasLimit:122_690n,verificationGasLimit:91_249n,preVerificationGas:317_416n,paymasterPostOpGasLimit:86_990n,paymasterVerificationGasLimit:95_799n,maxFeePerGas:128_100_000_000n};
  assert.equal(signedErc20FeeCap(operation,'0x754704Bc059F8C67012fEd69BC8A327a5aafb603'),2_702n);
  assert.throws(()=>signedErc20FeeCap(operation,'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),/unexpected mode or token/);
  const token='0x754704Bc059F8C67012fEd69BC8A327a5aafb603';
  const sender='0x1111111111111111111111111111111111111111';
  const paymaster='0x2222222222222222222222222222222222222222';
  const recipient='0x3333333333333333333333333333333333333333';
  const makeContext=approved=>({account:{address:sender,decodeCalls:async()=>[
    {to:token,data:encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[paymaster,approved]})},
    {to:token,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[recipient,1n]})},
  ]},paymasterAddress:paymaster,bundler:{prepareUserOperation:async()=>({...operation,sender,paymaster,callData:'0x01'})}});
  assert.equal((await prepareMonadFunding(makeContext(2_714n),{token,recipient,amount:1n})).feeCapAtoms,2_702n);
  await assert.rejects(()=>prepareMonadFunding(makeContext(2_701n),{token,recipient,amount:1n}),/approval/);
  await assert.rejects(()=>prepareMonadFunding(makeContext(2_730n),{token,recipient,amount:1n}),/approval/);
});

test('Circle USDC prefund includes all EntryPoint gas and the onchain spread', () => {
  const operation={preVerificationGas:50_000n,verificationGasLimit:70_000n,callGasLimit:100_000n,paymasterVerificationGasLimit:40_000n,paymasterPostOpGasLimit:40_000n,maxFeePerGas:1_000_000_000n};
  assert.equal(circleFeeCap(operation,{nativeTokenPrice:2_689_718_436n,feeSpread:1_000n,additionalGasCharge:35_000n}),991_161n);
  assert.throws(()=>circleFeeCap({...operation,maxFeePerGas:0n},{nativeTokenPrice:2_689_718_436n,feeSpread:0n,additionalGasCharge:35_000n}),/Invalid Circle/);
  assert.throws(()=>circleFeeCap({...operation,paymasterPostOpGasLimit:34_999n},{nativeTokenPrice:2_689_718_436n,feeSpread:0n,additionalGasCharge:35_000n}),/post-operation/);
});

test('Circle postOp charge reproduces historical and local fork receipts', () => {
  assert.equal(circleFinalCharge({actualGasCostWei:660_828n*1_118_379_612n,actualUserOpFeePerGas:1_118_379_612n,postOpGasLimit:35_000n},{nativeTokenPrice:2_652_033_376n,feeSpread:0n,additionalGasCharge:35_000n}),2_063_812n);
  const pricing={nativeTokenPrice:2_666_578_358n,feeSpread:0n,additionalGasCharge:35_000n};
  const operation={preVerificationGas:83_360n,verificationGasLimit:40_000n,callGasLimit:375_000n,paymasterVerificationGasLimit:120_000n,paymasterPostOpGasLimit:35_000n,maxFeePerGas:1_000_000_000n};
  const final=circleFinalCharge({actualGasCostWei:601_156n*1_000_000_000n,actualUserOpFeePerGas:1_000_000_000n,postOpGasLimit:35_000n},pricing);
  assert.equal(final,1_696_360n);
  assert.equal(circleFeeCap(operation,pricing)-final,139_206n);
  assert.equal(circleFeeCap({...operation,preVerificationGas:60_000n},pricing)-circleFinalCharge({actualGasCostWei:(601_156n-23_360n)*1_000_000_000n,actualUserOpFeePerGas:1_000_000_000n,postOpGasLimit:35_000n},pricing),139_206n);
  assert.equal(circleFinalCharge({actualGasCostWei:100_000n*1_000_000_000n,actualUserOpFeePerGas:1_000_000_000n,postOpGasLimit:50_000n},{nativeTokenPrice:2_000_000_000n,feeSpread:1_000n,additionalGasCharge:35_000n}),300_301n);
});

test('vault deposit plan rejects a changed vault or amount', () => {
  const vault='0x55C1B6e461a6334B567bAF0FEb5D728715446f05';
  const token='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
  const bundle='0x1111111111111111111111111111111111111111';
  const tx={to:bundle,data:'0x1234',value:0n,action:{type:'vaultV2Deposit',args:{vault,amount:2_000_000n}}};
  const approved=assertVaultDepositPlan({requirements:[],tx,vault,token,amount:2_000_000n});
  assert.deepEqual(approved,[{to:bundle,data:'0x1234',value:0n}]);
  assert.throws(()=>assertVaultDepositPlan({requirements:[],tx,vault,token,amount:3_000_000n}),/amount/);
  assert.throws(()=>assertVaultDepositPlan({requirements:[],tx:{...tx,action:{...tx.action,args:{...tx.action.args,vault:'0x2222222222222222222222222222222222222222'}}},vault,token,amount:2_000_000n}),/vault/);
});

test('rejects an intent whose receiver differs from the approved quote', () => {
  const payload = JSON.stringify({signer_id:'0x1234567890123456789012345678901234567890', verifying_contract:'intents.far', nonce:Buffer.alloc(32, 1).toString('base64'), deadline:'2030-01-01T00:00:00Z', intents:[{intent:'transfer',tokens:{'nep141:test':'3000000'},receiver_id:'wrong'}]});
  assert.throws(() => validatePreparedIntent({standard:'erc191',payload}, {signerId:'0x1234567890123456789012345678901234567890',verifyingContract:'intents.far',depositAddress:'right',tokenId:'nep141:test',amount:3000000n,now:new Date('2029-01-01')}), /receiver/);
});

test('encodes a 65-byte ERC-191 signature with normalized recovery bit', () => {
  const hex = `0x${'11'.repeat(64)}1b`;
  const encoded=encodeAuroraSignature(hex);
  assert.match(encoded, /^secp256k1:/);
  const bytes=base58.decode(encoded.slice('secp256k1:'.length));
  assert.equal(bytes.length,65);
  assert.equal(bytes[64],0);
  assert.throws(() => encodeAuroraSignature(`0x${'11'.repeat(64)}1d`), /recovery/);
});

test('rejects a generated intent that changes token amount', () => {
  const payload = JSON.stringify({signer_id:'0x1234567890123456789012345678901234567890',verifying_contract:'intents.far',nonce:Buffer.alloc(32,1).toString('base64'),deadline:'2030-01-01T00:00:00Z',intents:[{intent:'transfer',tokens:{'nep141:test':'3000001'},receiver_id:'right'}]});
  assert.throws(() => validatePreparedIntent({standard:'erc191',payload}, {signerId:'0x1234567890123456789012345678901234567890',verifyingContract:'intents.far',depositAddress:'right',tokenId:'nep141:test',amount:3000000n,now:new Date('2029-01-01')}), /token\/amount/);
});

// A route can shield the source asset itself; the quote must not silently switch to NEAR USDC.
test('uses Monad USDC as the confidential asset unless explicitly overridden', () => {
  const source={assetId:'monad-usdc',blockchain:'monad',symbol:'USDC',decimals:6};
  const near={assetId:'near-usdc',blockchain:'near',symbol:'USDC',decimals:6};
  assert.equal(chooseConfidentialAsset([source,near],source).assetId,'monad-usdc');
});


test('builds a timestamped versioned ERC-191 ownership proof for the public verifier', () => {
  const payload=JSON.parse(core.buildAuthPayload('0xAbCdEf0000000000000000000000000000001234','252812b3',new Date('2026-09-25T12:00:00.000Z'),Uint8Array.from([1,2,3,4,5,6,7])));
  assert.equal(payload.signer_id,'0xabcdef0000000000000000000000000000001234');
  assert.equal(payload.verifying_contract,'intents.near');
  assert.equal(payload.deadline,'2026-09-25T12:05:00.000Z');
  assert.equal(payload.nonce,'Vij2xgAlKBKzADhrndWO2BgAgAbEj47YGAECAwQFBgc=');
  assert.deepEqual(payload.intents,[]);
});

test('selects the private account balance by quote asset ID', () => {
  const assetId='nep245:v2_1.omni.hot.tg:143_test';
  const balances=[
    {tokenId:assetId,available:'1000000',source:'public'},
    {tokenId:assetId,available:'98009',source:'private'},
    {tokenId:`imt:shard:${assetId}`,available:'9999999',source:'private'},
  ];
  assert.deepEqual(core.selectPrivateBalance(balances,assetId),balances[1]);
  assert.throws(()=>core.selectPrivateBalance([],assetId),/missing or ambiguous/);
});
