import test from 'node:test';
import assert from 'node:assert/strict';
import {base58} from '@scure/base';
import {encodeFunctionData} from 'viem';
import * as core from '../src/core.mjs';
import {splitSourceBudget, validatePreparedIntent, encodeAuroraSignature, chooseConfidentialAsset} from '../src/core.mjs';
import {fundingAmount, signedErc20FeeCap, sourceBudget} from '../src/source-paymaster.mjs';
import {circleFeeCap} from '../src/circle-transfer.mjs';

test('splits an integer source budget 30/30/40 without exceeding it', () => {
  const amounts = splitSourceBudget(9_875_001n);
  assert.deepEqual(amounts, [2_962_500n, 2_962_500n, 3_950_001n]);
  assert.equal(amounts.reduce((a, b) => a + b), 9_875_001n);
});

test('source budget uses available USDC up to the 10 USDC cap', () => {
  assert.equal(sourceBudget(9_807_581n),9_807_581n);
  assert.equal(sourceBudget(12_000_000n),10_000_000n);
  assert.throws(() => sourceBudget(0n),/no USDC/);
});

test('source USDC transfer subtracts only the quoted paymaster fee from the available budget', () => {
  assert.equal(fundingAmount(10_000_000n, 23_702n), 9_976_298n);
  assert.equal(fundingAmount(9_807_581n, 23_702n), 9_783_879n);
  assert.throws(() => fundingAmount(9_807_581n, 9_807_581n), /fee consumes/);
});

test('source fee cap comes from the signed mainnet paymaster data', () => {
  const paymasterData='0x020000006ab68777000000000000754704bc059f8c67012fed69bc8a327a5aafb6030000000000000000000000000000907e0000000000000000000000000000000000000000000000000000000000006db300000000000000000000000000012b5fd8baa107006c93a030d1455a2ef43261b384f21cf93982eb796e157a62533b16bbaa83939855d16a9c1d28bb320f0035fceca56631936f8f7d63efdf5e5d55bd1a78fa2f337e0e72240cb026889f40a6e43a29541b';
  const operation={paymasterData,callGasLimit:122_690n,verificationGasLimit:91_249n,preVerificationGas:317_416n,paymasterPostOpGasLimit:86_990n,paymasterVerificationGasLimit:95_799n,maxFeePerGas:128_100_000_000n};
  assert.equal(signedErc20FeeCap(operation,'0x754704Bc059F8C67012fEd69BC8A327a5aafb603'),2_702n);
  assert.throws(()=>signedErc20FeeCap(operation,'0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),/unexpected mode or token/);
});

test('Circle USDC prefund includes all EntryPoint gas and the onchain spread', () => {
  const operation={preVerificationGas:50_000n,verificationGasLimit:70_000n,callGasLimit:100_000n,paymasterVerificationGasLimit:40_000n,paymasterPostOpGasLimit:40_000n,maxFeePerGas:1_000_000_000n};
  assert.equal(circleFeeCap(operation,{nativeTokenPrice:2_689_718_436n,feeSpread:1_000n,additionalGasCharge:35_000n}),991_161n);
  assert.throws(()=>circleFeeCap({...operation,maxFeePerGas:0n},{nativeTokenPrice:2_689_718_436n,feeSpread:0n,additionalGasCharge:35_000n}),/Invalid Circle/);
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

const router='0x111111125421cA6dc452d289314280a0f8842A65';
const usdg='0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const amzn='0x12f190a9F9d7D37a250758b26824B97CE941bF54';
const wallet='0x8ba1f109551bD432803012645Ac136ddd64DBA72';
const genericSwap=({receiver=wallet,src=usdg,dst=amzn,amount=2_000_000n,minReturn=7_920_000_000_000_000n}={})=>encodeFunctionData({abi:core.oneInchRouterAbi,functionName:'swap',args:['0x0000000000000000000000000000000000000001',{srcToken:src,dstToken:dst,srcReceiver:'0x0000000000000000000000000000000000000001',dstReceiver:receiver,amount,minReturnAmount:minReturn,flags:0n},'0x']});
const approvedSwap={router,srcToken:usdg,dstToken:amzn,receiver:wallet,amountIn:2_000_000n,slippageBps:100};
const swapResponse=(data,extra={})=>({dstAmount:'8000000000000000',tx:{from:wallet,to:router,data,value:'0',...extra}});

test('USDG swap amount leaves exactly the signed paymaster fee cap', () => {
  assert.equal(core.swapAmount(2_303_576n,41_205n),2_262_371n);
  assert.throws(()=>core.swapAmount(2_303_576n,2_303_576n),/fee consumes/);
  assert.throws(()=>core.swapAmount(0n,0n),/fee consumes/);
});

test('liquidity rule compares the reference-size rate with a small probe', () => {
  const probe={amountIn:10_000_000n,amountOut:40_000_000_000_000_000n};
  assert.equal(core.priceImpactBps(probe,{amountIn:1_000_000_000n,amountOut:3_960_000_000_000_000_000n}),100n);
  assert.equal(core.passesLiquidityRule(probe,{amountIn:1_000_000_000n,amountOut:3_960_000_000_000_000_000n},100),true);
  assert.equal(core.passesLiquidityRule(probe,{amountIn:1_000_000_000n,amountOut:3_900_000_000_000_000_000n},100),false);
  assert.equal(core.priceImpactBps(probe,{amountIn:1_000_000_000n,amountOut:4_100_000_000_000_000_000n}),0n);
  assert.throws(()=>core.priceImpactBps(probe,{amountIn:1n,amountOut:0n}),/positive/);
});

test('accepts a router swap bound to the wallet, pair, amount and minimum', () => {
  const accepted=core.validateRouterQuote(swapResponse(genericSwap()),approvedSwap);
  assert.equal(accepted.minOut,7_920_000_000_000_000n);
  assert.equal(accepted.to,router);
});

test('rejects router calldata that changes router, receiver, token, amount or minimum', () => {
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap(),{to:amzn}),approvedSwap),/unapproved router/);
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap({receiver:router})),approvedSwap),/receiver/);
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap({dst:usdg})),approvedSwap),/tokens/);
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap({amount:2_000_001n})),approvedSwap),/amount/);
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap({minReturn:1n})),approvedSwap),/minimum return/);
  assert.throws(()=>core.validateRouterQuote(swapResponse(genericSwap(),{value:'1'}),approvedSwap),/native value/);
  assert.throws(()=>core.validateRouterQuote(swapResponse('0xdeadbeef'),approvedSwap),/Unsupported router function/);
});

test('checks packed addresses in unoswap router calls', () => {
  const unoswapTo=to=>encodeFunctionData({abi:core.oneInchRouterAbi,functionName:'unoswapTo',args:[BigInt(to),BigInt(usdg),2_000_000n,7_920_000_000_000_000n,123n]});
  assert.equal(core.validateRouterCall(unoswapTo(wallet),{...approvedSwap,minOut:7_920_000_000_000_000n}).functionName,'unoswapTo');
  assert.throws(()=>core.validateRouterCall(unoswapTo(router),{...approvedSwap,minOut:7_920_000_000_000_000n}),/receiver/);
});

const permit=`0x${'11'.repeat(224)}`;
const fusionOrder=(extra={})=>({maker:wallet,receiver:wallet,makerAsset:usdg,takerAsset:amzn,makingAmount:325_847n,takingAmount:977_347_500_718_082n,deadline:2_000_000_000n,makerPermit:`${usdg.toLowerCase()}${permit.slice(2)}`,...extra});
const approvedFusion={maker:wallet,srcToken:usdg,dstToken:amzn,amount:325_847n,minOut:970_000_000_000_000n,permit,now:1_900_000_000_000};

test('accepts a Fusion order bound to the wallet, pair, amount, minimum and permit', () => {
  assert.deepEqual(core.validateFusionOrder(fusionOrder(),approvedFusion),{minOut:977_347_500_718_082n,deadline:2_000_000_000n});
});

test('rejects Fusion orders that change maker, receiver, tokens, amount, minimum, permit or expiry', () => {
  assert.throws(()=>core.validateFusionOrder(fusionOrder({maker:router}),approvedFusion),/maker differs/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({receiver:router}),approvedFusion),/receiver/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({takerAsset:usdg}),approvedFusion),/tokens/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({makingAmount:325_846n}),approvedFusion),/making amount/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({takingAmount:969_999_999_999_999n}),approvedFusion),/below the approved minimum/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({makerPermit:'0x'}),approvedFusion),/different maker permit/);
  assert.throws(()=>core.validateFusionOrder(fusionOrder({deadline:1_900_000_000n}),approvedFusion),/expired/);
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
