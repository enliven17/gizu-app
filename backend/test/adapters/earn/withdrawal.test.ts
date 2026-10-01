import assert from "node:assert/strict";
import { test } from "node:test";
import { EthereumWithdrawalPlanner } from "../../../src/adapters/earn/ethereum-withdrawal-planner.ts";
const now=1900000000000;
const owner="0x1111111111111111111111111111111111111111";
const state={block:{number:100n,hash:"0x"+"a".repeat(64),timestamp:BigInt(now/1000),baseFeePerGas:100n,gasUsed:15n,gasLimit:30n},owner,usdc:50000n,eth:10n**18n,weth:0n,shares:1000000n,nonce:4n,usdcAllowance:0n,shareAllowance:0n,ownerCode:"0x",shareDecimals:18,tips:Array(8).fill(10000n)};
function planner(override={}) {
  return new EthereumWithdrawalPlanner({rpcUrl:"https://rpc.invalid",anvilPath:"/private/tmp/anvil"},{readState:async()=>state,assertFresh:async()=>{},simulate:async()=>[{to:"0x02912516d49dE997db75B9D7858faAE59209650B",data:"0x01",estimatedGas:100n,actualGas:99n}],...override},()=>now);
}
test("withdrawal preview is separately requested, uses current shares and consumes reserve without reserving it again",async()=>{
  const result=await planner().plan({owner,operationId:"exit1",revision:1});
  assert.equal(result.kind,"vaultRedeemAll");assert.equal(result.amountAtoms,"1000000");
  assert.equal(result.retainedAfterActionWei,"0");assert.equal(result.gasLimits[0],"130");
  assert.equal(result.maximumGasCostWei,(130n*BigInt(result.maxFeePerGasWei)).toString());
  assert.equal(result.readOnly,true);assert.equal(result.executionAvailable,false);
  assert.equal(result.returnsQuoted,false);assert.ok(Object.isFrozen(result));
});
test("no position, unexpected WETH or insufficient current gas cannot produce an exit plan",async()=>{
  for(const changes of [{shares:0n},{weth:1n},{eth:0n}]) await assert.rejects(planner({readState:async()=>({...state,...changes})}).plan({owner,operationId:"exit1",revision:1}));
});
