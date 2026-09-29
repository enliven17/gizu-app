// Replay captured synthetic operations against their original mainnet block.
// No provider quotes, user keys, or public transaction submission are used.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {erc20Abi,encodeFunctionData,toHex,pad,parseAbi,parseEventLogs} from 'viem';
import {entryPoint08Address,entryPoint08Abi,formatUserOperation,toPackedUserOperation} from 'viem/account-abstraction';
import {erc20BalanceOverride} from 'permissionless/utils';
import {withNativeFork} from '../src/native-simulation.mjs';
import {hood} from '../src/robinhood-vault.mjs';
import {tokenPaymaster} from '../src/robinhood-paymaster.mjs';
import {json} from '../src/native-runtime.mjs';
const fixture=JSON.parse(await readFile(new URL('../fixtures/robinhood-cycle-operations.json',import.meta.url),'utf8'));
const events=parseAbi(['event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
await withNativeFork({rpcUrl:process.env.ROBINHOOD_RPC_URL||hood.rpc,blockNumber:BigInt(fixture.block),chain:hood.chain,anvilPath:process.env.ANVIL_PATH||'anvil',allowSameTimestamp:true},async client=>{
 assert.equal(new URL(client.transport.url).hostname,'127.0.0.1');
 const {owner,beneficiary}=fixture;
 await client.request({method:'anvil_setCode',params:[owner,fixture.delegation]});
 const [tokenOverride]=erc20BalanceOverride({token:hood.token,owner,slot:1n,balance:BigInt(fixture.initialBalance)});
 await client.request({method:'anvil_setStorageAt',params:[hood.token,tokenOverride.stateDiff[0].slot,pad(tokenOverride.stateDiff[0].value)]});
 await client.request({method:'anvil_setStorageAt',params:[tokenPaymaster,fixture.signerSlot,toHex(1n,{size:32})]});
 await client.request({method:'anvil_impersonateAccount',params:[beneficiary]});
 await client.request({method:'anvil_setBalance',params:[beneficiary,toHex(10n**20n)]});
 const send=async(data,value=0n)=>{
  const hash=await client.request({method:'eth_sendTransaction',params:[{from:beneficiary,to:entryPoint08Address,data,value:toHex(value),gas:'0x989680'}]});
  const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');return receipt;
 };
 await send(encodeFunctionData({abi:entryPoint08Abi,functionName:'depositTo',args:[tokenPaymaster]}),10n**18n);
 const evidence=[];
 for(const row of fixture.operations){
  await client.request({method:'evm_setNextBlockTimestamp',params:[Number(row.timestamp)]});
  await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(BigInt(row.baseFeePerGas))]});
  const op=formatUserOperation(row.signed.rpcOperation);
  const receipt=await send(encodeFunctionData({abi:entryPoint08Abi,functionName:'handleOps',args:[[toPackedUserOperation(op)],beneficiary]}));
  const event=parseEventLogs({abi:events,logs:receipt.logs}).find(e=>e.args.userOpHash===row.signed.hash);
  assert(event);assert.equal(event.args.success,true);assert.equal(event.args.actualGasUsed,BigInt(row.actualGasUsed));
  evidence.push({hash:row.signed.hash,nonce:op.nonce,actualGasUsed:event.args.actualGasUsed});
 }
 const final={token:await client.readContract({address:hood.token,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),shares:await client.readContract({address:hood.vault,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),native:await client.getBalance({address:owner})};
 for(const key of Object.keys(final))assert.equal(final[key],BigInt(fixture.final[key]));
 await writeFile(new URL('../fixtures/robinhood-replay.json',import.meta.url),json({scope:'Exact captured synthetic operations replayed locally, same pinned mainnet state, timestamps, base fees and gas limits. No live provider quotes or submissions.',block:fixture.block,evidence,final})+'\n');
 console.log(json({replay:'passed',operations:evidence.length,final}));
});
