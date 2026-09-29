// Public, already-consumed historical calldata only. No private keys or live submissions.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,decodeFunctionData,erc20Abi,http,parseAbi,parseEventLogs,toHex} from 'viem';
import {entryPoint08Abi} from 'viem/account-abstraction';
import {circlePaymaster,vaultAddress} from '../src/vault-deposit.mjs';

const label=process.argv[2]??'candide';
assert(['candide','first'].includes(label));
const url=`http://127.0.0.1:${label==='first'?18548:18554}`;
const client=createPublicClient({transport:http(url,{timeout:120_000,retryCount:0})});
assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);
assert.equal(await client.getChainId(),1);
const fixture=JSON.parse(await readFile(new URL(`../fixtures/${label}-public-transaction.json`,import.meta.url),'utf8'));
const {tx,block}=fixture;
assert.equal(await client.getBlockNumber(),BigInt(tx.blockNumber)-1n,'Fork must start at the parent block');
const decoded=decodeFunctionData({abi:entryPoint08Abi,data:tx.input});
assert.equal(decoded.functionName,'handleOps');
assert.equal(decoded.args[0].length,1);
const owner=decoded.args[0][0].sender;
const token='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const balance=()=>client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
const shares=()=>client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[owner]});
const before={usdc:await balance(),shares:await shares(),eth:await client.getBalance({address:owner})};
const snapshot=await client.request({method:'evm_snapshot'});
try {
  await client.request({method:'anvil_dropAllTransactions'});
  await client.request({method:'anvil_impersonateAccount',params:[tx.from]});
  await client.request({method:'evm_setAutomine',params:[false]});
  await client.request({method:'anvil_setCoinbase',params:[block.miner]});
  let prefixHash;
  if(label==='first') {
    const prefix=JSON.parse(await readFile(new URL('../fixtures/first-vault-prefix-transaction.json',import.meta.url),'utf8'));
    await client.request({method:'anvil_impersonateAccount',params:[prefix.from]});
    prefixHash=await client.request({method:'eth_sendTransaction',params:[{from:prefix.from,to:prefix.to,data:prefix.input,value:prefix.value,nonce:prefix.nonce,gas:prefix.gas,accessList:prefix.accessList,maxFeePerGas:prefix.maxFeePerGas,maxPriorityFeePerGas:prefix.maxPriorityFeePerGas}]});
  }
  const hash=await client.request({method:'eth_sendTransaction',params:[{from:tx.from,to:tx.to,data:tx.input,value:tx.value,nonce:tx.nonce,gas:tx.gas,accessList:tx.accessList,maxFeePerGas:tx.maxFeePerGas,maxPriorityFeePerGas:tx.maxPriorityFeePerGas,...(tx.authorizationList?.length?{type:'0x4',authorizationList:tx.authorizationList}:{})}]});
  await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[block.baseFeePerGas]});
  await client.request({method:'evm_setNextBlockTimestamp',params:[Number(BigInt(block.timestamp))]});
  await client.request({method:'evm_mine'});
  const receipt=await client.getTransactionReceipt({hash});
  if(prefixHash) {
    const prefixReceipt=await client.getTransactionReceipt({hash:prefixHash});
    assert.equal(prefixReceipt.status,'success');
    assert(prefixReceipt.transactionIndex<receipt.transactionIndex,'Start Anvil with --order fifo');
  }
  if(process.env.REPLAY_TRACE==='1') await writeFile(`/private/tmp/earn-${label}-local-trace.json`,JSON.stringify(await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]})));
  const abi=parseAbi(['event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)','event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)']);
  const events=parseEventLogs({abi,logs:receipt.logs});
  const fee=events.find(e=>e.eventName==='UserOperationSponsored'&&e.address.toLowerCase()===circlePaymaster.toLowerCase());
  const op=events.find(e=>e.eventName==='UserOperationEvent');
  const deposit=events.find(e=>e.eventName==='Deposit'&&e.address.toLowerCase()===vaultAddress.toLowerCase());
  assert.equal(receipt.status,'success'); assert.equal(op?.args.success,true);
  assert(fee&&deposit);
  const after={usdc:await balance(),shares:await shares(),eth:await client.getBalance({address:owner})};
  assert.equal(after.eth,before.eth);
  assert.equal(before.usdc-after.usdc-deposit.args.assets,fee.args.actualTokenNeeded);
  assert.equal(after.shares-before.shares,deposit.args.shares);
  const historicalOp=parseEventLogs({abi,logs:fixture.receipt.logs}).find(e=>e.eventName==='UserOperationEvent');
  assert.equal(op.args.actualGasUsed,historicalOp.args.actualGasUsed,'Must reproduce EntryPoint accounting');
  assert.equal(receipt.gasUsed,BigInt(fixture.receipt.gasUsed),'Must reproduce transaction gas');
  const result={label,historicalTransaction:tx.hash,forkParent:Number(BigInt(tx.blockNumber)-1n),scope:label==='first'?'Original signed UserOperation plus preceding same-block vault reallocation at index 216; unrelated block transactions omitted':'Original signed UserOperation at parent-block state and historical timestamp/base fee; preceding same-block transactions not replayed',before,after,deposit:deposit.args.assets,charge:fee.args.actualTokenNeeded,operationGas:op.args.actualGasUsed,transactionGas:receipt.gasUsed,passesResidual:after.usdc<500_000n,localTransaction:hash};
  const json=JSON.stringify(result,(_k,v)=>typeof v==='bigint'?String(v):v,2);
  console.log(json);
  await writeFile(new URL(`../fixtures/${label}-replay-result.json`,import.meta.url),json+'\n');
  if(label==='candide') {
    assert.equal(fee.args.actualTokenNeeded,1_726_651n,'Must reproduce the historical Circle charge');
    assert.equal(after.usdc,1_731_762n,'Must reproduce the historical residual');
    assert.equal(deposit.args.assets,134_142n);
    assert.equal(deposit.args.shares,133_013_839_453_606_864n);
  } else {
    assert.equal(fee.args.actualTokenNeeded,2_063_812n);
    assert.equal(after.usdc,2_464_035n);
    assert.equal(deposit.args.assets,1_128_419n);
    assert.equal(deposit.args.shares,1_119_037_849_207_314_848n);
  }
} finally {await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_revert',params:[snapshot]});await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_setAutomine',params:[true]});}
