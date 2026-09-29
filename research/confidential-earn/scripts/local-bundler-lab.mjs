// End-to-end LOCAL bundler test. All endpoints are fixed loopback addresses.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,erc20Abi,getAddress,http,parseAbi,parseEventLogs,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {entryPoint08Address,formatUserOperationRequest,toSimple7702SmartAccount} from 'viem/account-abstraction';
import {vaultAddress} from '../src/vault-deposit.mjs';
const client=createPublicClient({chain:mainnet,transport:http('http://127.0.0.1:18554',{timeout:120000,retryCount:0})});
assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);assert.equal(await client.getChainId(),1);
const original=JSON.parse(await readFile(new URL('../fixtures/candide-public-transaction.json',import.meta.url),'utf8'));
assert.equal(await client.getBlockNumber(),BigInt(original.tx.blockNumber)-1n);
const operations=JSON.parse(await readFile(new URL('../.local/residual-lab-operations.json',import.meta.url),'utf8'));
const candidate=operations['bounded-hold-0.1-gwei'];
const owner=getAddress(candidate.rpcOperation.sender);
const bundler=privateKeyToAccount((await readFile(new URL('../.local/bundler-test-key',import.meta.url),'utf8')).trim());
const token='0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const rpc=async(method,params)=>fetch('http://127.0.0.1:18560/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)}).then(r=>r.json());
const snapshot=await client.request({method:'evm_snapshot'});
try{
 await rpc('debug_bundler_clearState',[]);
 await client.request({method:'anvil_setBalance',params:[owner,'0x0']});
 await client.request({method:'anvil_setBalance',params:[bundler.address,toHex(10n**19n)]});
 await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:['0x4c4b400']});
 await client.request({method:'evm_setNextBlockTimestamp',params:[Number(BigInt(original.block.timestamp))]});
 await client.request({method:'evm_mine'});
 // Give the provider's one-second recommendation cache time to observe the fixture.
 await new Promise(resolve=>setTimeout(resolve,1500));
 const lowBid=await rpc('eth_sendUserOperation',[operations['bounded-hold-0.02-gwei-optimal'].rpcOperation,entryPoint08Address]);
 assert(lowBid.error,'Underpriced operation must be rejected in the 0.1-gwei market');
 await rpc('debug_bundler_clearState',[]);
 const wallet=privateKeyToAccount(process.env.DEST2_PK);
 assert.equal(wallet.address,owner);
 const account=await toSimple7702SmartAccount({client,owner:wallet});
 const insufficientVerification={...candidate.rpcOperation};
 for(const key of ['nonce','callGasLimit','verificationGasLimit','preVerificationGas','paymasterVerificationGasLimit','paymasterPostOpGasLimit','maxFeePerGas','maxPriorityFeePerGas']) insufficientVerification[key]=BigInt(insufficientVerification[key]);
 insufficientVerification.verificationGasLimit=51_698n;
 insufficientVerification.signature=await account.signUserOperation(insufficientVerification);
 const verificationRejection=await rpc('eth_sendUserOperation',[formatUserOperationRequest(insufficientVerification),entryPoint08Address]);
 assert.match(verificationRejection.error?.message??'',/verificationGas should have extra 2000 gas/);
 await rpc('debug_bundler_clearState',[]);
 const admitted=await rpc('eth_sendUserOperation',[candidate.rpcOperation,entryPoint08Address]);
 assert(admitted.result,JSON.stringify(admitted.error));
 const cached=await rpc('eth_getUserOperationReceipt',[admitted.result]);
 assert(!cached.result,'Restart the local Voltaire container before repeating this test: its receipt cache survives debug_bundler_clearState and fork snapshots');
 await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:['0x4c4b400']});
 await client.request({method:'evm_setNextBlockTimestamp',params:[Number(BigInt(original.block.timestamp))+12]});
 const bundle=await rpc('debug_bundler_sendBundleNow',[]);
 let opReceipt;
 for(let attempt=0;attempt<12;attempt++){
  const result=await rpc('eth_getUserOperationReceipt',[admitted.result]);
  if(result.result){opReceipt=result.result;break;}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 assert(opReceipt,JSON.stringify(bundle));assert.equal(opReceipt.success,true);
 const receipt=await client.getTransactionReceipt({hash:opReceipt.receipt.transactionHash});
 const inclusion=await client.getBlock({blockNumber:receipt.blockNumber});
 assert.equal(inclusion.timestamp,BigInt(original.block.timestamp)+12n);
 assert.equal(inclusion.baseFeePerGas,80_000_000n);
 const [residual,shares,eth]=await Promise.all([
  client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),
  client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[owner]}),client.getBalance({address:owner})]);
 const abi=parseAbi(['event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)','event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)']);
 const events=parseEventLogs({abi,logs:receipt.logs});
 const deposit=events.find(x=>x.eventName==='Deposit'&&x.address.toLowerCase()===vaultAddress.toLowerCase());
 const sponsor=events.find(x=>x.eventName==='UserOperationSponsored');
 assert.equal(events.filter(x=>x.eventName==='UserOperationEvent').length,1);
 assert.equal(getAddress(deposit.args.owner),owner);assert.equal(deposit.args.assets,BigInt(candidate.amount));assert.equal(shares,deposit.args.shares);
 assert.equal(BigInt(candidate.balance)-residual-deposit.args.assets,sponsor.args.actualTokenNeeded);
 assert.equal(eth,0n);assert(residual<500000n);assert(residual<=BigInt(candidate.hold));
 const result={scope:'Counterfactual 0.08-gwei base / 0.02-gwei recommended priority, pinned local Voltaire with DEFAULT fee tolerance and full validation (no --unsafe); not public Candide admission',image:'sha256:ba8a23fbaae9bed49a671152c3ec404fcd5a8debd86fdfa5e8138279a71da26d',historicalForkParent:26079549,inclusionTimestamp:inclusion.timestamp,underpricedRejection:lowBid.error,verificationRejection:verificationRejection.error,admittedHash:admitted.result,localTransaction:receipt.transactionHash,bundleResponse:bundle,deposit:deposit.args.assets,charge:sponsor.args.actualTokenNeeded,residual,shares,zeroEth:true,oneWalletOnly:true};
 const json=JSON.stringify(result,(_k,v)=>typeof v==='bigint'?v.toString():v,2);await writeFile(new URL('../fixtures/local-bundler-execution.json',import.meta.url),json+'\n');console.log(json);
}finally{
 await rpc('debug_bundler_clearState',[]);await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_revert',params:[snapshot]});await client.request({method:'anvil_dropAllTransactions'});
}
