// Counterfactual tests only. Historical wallet/signature nonces; localhost execution.
// Never calls a public bundler or submits a transaction to an upstream RPC.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createPublicClient,decodeErrorResult,decodeFunctionData,encodeFunctionData,encodePacked,erc20Abi,getAddress,http,maxUint256,parseAbi,parseEventLogs,toHex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {entryPoint08Abi,entryPoint08Address,formatUserOperationRequest,toPackedUserOperation,toSimple7702SmartAccount,toUserOperation} from 'viem/account-abstraction';
import {vaultV2Deposit,encodeErc20Approval} from '@morpho-org/morpho-sdk';
import {vaultBundlesV1Abi} from '@morpho-org/morpho-sdk/abis';
import {assertVaultDepositPlan,circleFeeCap,circlePaymaster,vaultAddress} from '../src/vault-deposit.mjs';
import {circleResidualBound} from '../src/residual-policy.mjs';
const token=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const owner=privateKeyToAccount(process.env.DEST2_PK);
const feesAbi=parseAbi(['function fetchPrice() view returns(uint256)','function feeSpread() view returns(uint32)','function additionalGasCharge() view returns(uint32)']);
const permitAbi=parseAbi(['function name() view returns(string)','function version() view returns(string)','function nonces(address) view returns(uint256)']);
const eventAbi=parseAbi(['event UserOperationSponsored(address indexed token,address indexed sender,bytes32 userOpHash,uint256 nativeTokenPrice,uint256 actualTokenNeeded,uint256 feeTokenAmount)','event UserOperationEvent(bytes32 indexed userOpHash,address indexed sender,address indexed paymaster,uint256 nonce,bool success,uint256 actualGasCost,uint256 actualGasUsed)','event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)']);
const cases=[
 {label:'candide',name:'historical-fee-tighter-limits',fee:953266314n,priority:200000000n,base:753266314n,tighter:true,accepted:false},
 {label:'first',name:'warm-vault-historical-fee-tighter-limits',fee:1292466979n,priority:748275050n,base:370104562n,tighter:true,accepted:false},
 {label:'candide',name:'bounded-hold-0.1-gwei',fee:100000000n,priority:20000000n,base:80000000n,accepted:true},
 {label:'first',name:'bounded-hold-0.1-gwei-first-delegation',fee:100000000n,priority:20000000n,base:80000000n,accepted:true},
 {label:'candide',name:'bounded-hold-0.02-gwei-optimal',fee:20000000n,priority:1000000n,base:19000000n,accepted:true,optimal:true},
 {label:'candide',name:'bounded-hold-inclusion-fee-collapses',fee:100000000n,priority:1n,base:0n,accepted:true},
 {label:'candide',name:'insufficient-call-gas-must-fail',fee:100000000n,priority:20000000n,base:80000000n,callGas:100000n,accepted:true,executionFails:true},
];
const output=[];
const localOperations={};
for(const c of cases) {
 const url=`http://127.0.0.1:${c.label==='first'?18548:18554}`;
 const client=createPublicClient({chain:mainnet,transport:http(url,{timeout:120000,retryCount:0})});
 assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);assert.equal(await client.getChainId(),1);
 const fixture=JSON.parse(await readFile(new URL(`../fixtures/${c.label}-public-transaction.json`,import.meta.url),'utf8'));
 const {tx,block}=fixture;
 assert.equal(await client.getBlockNumber({cacheTime:0}),BigInt(tx.blockNumber)-1n);
 const original=decodeFunctionData({abi:entryPoint08Abi,data:tx.input}).args[0][0];
 assert.equal(getAddress(original.sender),owner.address);
 const snapshot=await client.request({method:'evm_snapshot'});
 try {
  await client.request({method:'anvil_dropAllTransactions'});
  await client.request({method:'evm_setAutomine',params:[false]});
  await client.request({method:'anvil_setBalance',params:[owner.address,'0x0']});
  await client.request({method:'anvil_impersonateAccount',params:[tx.from]});
  await client.request({method:'anvil_setCoinbase',params:[block.miner]});
  await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(c.base)]});
  const smart=await toSimple7702SmartAccount({client,owner});
  const [balance,beforeShares,name,version,permitNonce,price,spread,additional]=await Promise.all([
   client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
   client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
   ...['name','version','nonces'].map(functionName=>client.readContract({address:token,abi:permitAbi,functionName,...(functionName==='nonces'?{args:[owner.address]}:{})})),
   ...['fetchPrice','feeSpread','additionalGasCharge'].map(functionName=>client.readContract({address:circlePaymaster,abi:feesAbi,functionName})),
  ]);
  const op={...toUserOperation(original),maxFeePerGas:c.fee,maxPriorityFeePerGas:c.priority};
  if(tx.authorizationList?.length) op.authorization={address:tx.authorizationList[0].address,chainId:1,nonce:Number(BigInt(tx.authorizationList[0].nonce))};
  assert.equal(await smart.getNonce({key:op.nonce>>64n}),op.nonce);
  if(c.tighter) Object.assign(op,{callGasLimit:410000n,verificationGasLimit:165395n,paymasterVerificationGasLimit:c.label==='first'?140000n:125000n});
  if(c.callGas)op.callGasLimit=c.callGas;
  const hold=circleFeeCap(op,{nativeTokenPrice:price,feeSpread:BigInt(spread),additionalGasCharge:BigInt(additional)});
  assert(hold<balance);
  const amount=balance-hold;
  const bound=circleResidualBound({balance,amount});
  assert.equal(bound.accepted,c.accepted);
  const originalCalls=await smart.decodeCalls(original.callData);
  const originalDeposit=decodeFunctionData({abi:vaultBundlesV1Abi,data:originalCalls.at(-1).data});
  assert.equal(originalDeposit.functionName,'vaultBundlesV1Deposit');
  // Preserve the real signed share-price bound and deadline. Only the amount changes.
  const [, ,maxSharePrice,,referralFeePct,referralFeeRecipient,deadline]=originalDeposit.args;
  assert.equal(referralFeePct,0n);
  const plan=vaultV2Deposit({vault:{chainId:1,address:vaultAddress,asset:token},args:{amount,userAddress:owner.address,maxSharePrice,referralFeePct,referralFeeRecipient,deadline}});
  const approval=encodeErc20Approval({chainId:1,token,spender:plan.to,amount});
  const calls=assertVaultDepositPlan({requirements:[approval],tx:plan,vault:vaultAddress,token,amount});
  assert(calls.length>=1);
  op.callData=await smart.encodeCalls(calls);
  const permit={domain:{name,version,chainId:1,verifyingContract:token},primaryType:'Permit',types:{Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},message:{owner:owner.address,spender:circlePaymaster,value:hold,nonce:permitNonce,deadline:maxUint256}};
  op.paymasterData=encodePacked(['uint8','address','uint256','bytes'],[0,token,hold,await owner.signTypedData(permit)]);
  op.signature=await smart.signUserOperation(op);
  localOperations[c.name]={rpcOperation:formatUserOperationRequest(op),balance:String(balance),amount:String(amount),hold:String(hold)};
  const data=encodeFunctionData({abi:entryPoint08Abi,functionName:'handleOps',args:[[toPackedUserOperation(op)],tx.from]});
  let prefixHash;
  if(c.label==='first') {
   const prefix=JSON.parse(await readFile(new URL('../fixtures/first-vault-prefix-transaction.json',import.meta.url),'utf8'));
   await client.request({method:'anvil_impersonateAccount',params:[prefix.from]});
   prefixHash=await client.request({method:'eth_sendTransaction',params:[{from:prefix.from,to:prefix.to,data:prefix.input,value:prefix.value,nonce:prefix.nonce,gas:prefix.gas,maxFeePerGas:prefix.maxFeePerGas,maxPriorityFeePerGas:prefix.maxPriorityFeePerGas}]});
  }
  const hash=await client.request({method:'eth_sendTransaction',params:[{from:tx.from,to:entryPoint08Address,data,nonce:tx.nonce,gas:'0x300000',maxFeePerGas:'0xb2d05e00',maxPriorityFeePerGas:'0x1',...(tx.authorizationList?.length?{type:'0x4',authorizationList:tx.authorizationList}:{})}]});
  await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(c.base)]});
  await client.request({method:'evm_setNextBlockTimestamp',params:[Number(BigInt(block.timestamp))]});
  await client.request({method:'evm_mine'});
  const receipt=await client.getTransactionReceipt({hash}).catch(async error=>{
   const mined=await client.getBlock({blockTag:'latest'});
   const pool=await client.request({method:'txpool_status'});
   console.error(JSON.stringify({case:c.name,block:String(mined.number),base:String(mined.baseFeePerGas),transactions:mined.transactions.length,pool}));
   throw error;
  });
  if(receipt.status!=='success') {
   const trace=await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]});
   try{console.error(decodeErrorResult({abi:entryPoint08Abi,data:trace.output}));}catch{console.error({reverted:true});}
  }
  assert.equal(receipt.status,'success');
  if(prefixHash){const p=await client.getTransactionReceipt({hash:prefixHash});assert.equal(p.status,'success');assert(p.transactionIndex<receipt.transactionIndex);}
  const events=parseEventLogs({abi:eventAbi,logs:receipt.logs});
  const event=events.find(x=>x.eventName==='UserOperationEvent');
  const charge=events.find(x=>x.eventName==='UserOperationSponsored');
  const deposits=events.filter(x=>x.eventName==='Deposit'&&x.address.toLowerCase()===vaultAddress.toLowerCase());
  const afterBalance=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]});
  const afterShares=await client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]});
  assert.equal(await client.getBalance({address:owner.address}),0n,'Destination must not use ETH');
  assert.equal(events.filter(x=>x.eventName==='UserOperationEvent').length,1,'No two-wallet UserOperation batch');
  assert.equal(getAddress(event.args.sender),owner.address);
  const forbidden=process.env.DEST1_ADD?.toLowerCase().slice(2);
  assert(forbidden,'DEST1_ADD is required for the no-wallet-1-reference test');
  assert(!data.toLowerCase().includes(forbidden),'Operation must not reference wallet 1');
  assert(!JSON.stringify(receipt.logs,(_k,v)=>typeof v==='bigint'?v.toString():v).toLowerCase().includes(forbidden),'Receipt must not reference wallet 1');
  assert(charge);
  if(c.executionFails) {
   assert.equal(event.args.success,false);assert.equal(deposits.length,0);assert.equal(afterShares,beforeShares);
   assert.equal(balance-afterBalance,charge.args.actualTokenNeeded);
  } else {
   assert.equal(event.args.success,true);assert.equal(deposits.length,1);
   assert.equal(getAddress(deposits[0].args.owner),owner.address);assert.equal(deposits[0].args.assets,amount);
   assert.equal(afterShares-beforeShares,deposits[0].args.shares);
   assert.equal(balance-afterBalance-amount,charge.args.actualTokenNeeded);
   assert(afterBalance<=bound.maximumResidualAtoms);
   if(c.accepted)assert(afterBalance<500000n);
   if(c.optimal)assert(afterBalance<100000n);
  }
  const result={name:c.name,historicalState:c.label,changedFields:['deposit amount','permit amount/signature','UserOperation signature','gas fees','inclusion base fee','destination ETH set to zero',...(c.tighter||c.callGas?['gas limits']:[])],providerAdmission:'NOT PROVEN; direct local EntryPoint execution only',configuration:{callGasLimit:op.callGasLimit,verificationGasLimit:op.verificationGasLimit,preVerificationGas:op.preVerificationGas,paymasterVerificationGasLimit:op.paymasterVerificationGasLimit,paymasterPostOpGasLimit:op.paymasterPostOpGasLimit,maxFeePerGas:op.maxFeePerGas,maxPriorityFeePerGas:op.maxPriorityFeePerGas,baseFeePerGas:c.base},beforeBalance:balance,deposit:deposits[0]?.args.assets??0n,maximumHold:hold,charge:charge.args.actualTokenNeeded,residual:afterBalance,executionSucceeded:event.args.success,acceptedByBound:bound.accepted,meetsResidual:afterBalance<500000n,sharesMinted:afterShares-beforeShares,zeroEth:true,otherDestinationAbsent:true};
  output.push(result);console.log(JSON.stringify(result,(_k,v)=>typeof v==='bigint'?v.toString():v));
 }finally {
  await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_revert',params:[snapshot]});await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_setAutomine',params:[true]});
 }
}
await writeFile(new URL('../fixtures/residual-fork-results.json',import.meta.url),JSON.stringify({scope:'Counterfactual executions, not live relay acceptance. No incoming USDC between planning and execution.',results:output},(_k,v)=>typeof v==='bigint'?v.toString():v,2)+'\n');
await mkdir(new URL('../.local/',import.meta.url),{recursive:true,mode:0o700});
await writeFile(new URL('../.local/residual-lab-operations.json',import.meta.url),JSON.stringify(localOperations),{mode:0o600});
