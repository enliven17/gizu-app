// Run only against a local Anvil Ethereum fork. This script never contacts the public bundler.
import {readFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,encodeFunctionData,encodePacked,erc20Abi,getAddress,hexToBigInt,http,maxUint256,parseAbi,parseEventLogs} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {entryPoint08Abi,entryPoint08Address,toPackedUserOperation,toSimple7702SmartAccount} from 'viem/account-abstraction';
import {morphoViemExtension} from '@morpho-org/morpho-sdk';
import {assertVaultDepositPlan,circleFeeCap,circleFinalCharge,circlePaymaster,vaultAddress} from '../src/vault-deposit.mjs';
import {nextBlockBid} from '../src/ethereum-fee.mjs';

const client=createPublicClient({chain:mainnet,transport:http('http://127.0.0.1:8545')});
const state=JSON.parse(await readFile(new URL('../.local/state.json',import.meta.url),'utf8'));
const owner=privateKeyToAccount(process.env.DEST2_PK);
if(owner.address!==getAddress(state.vaultDeposits[1].owner)) throw new Error('Wrong local signer');
const smart=await toSimple7702SmartAccount({client,owner});
const token=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const morpho=createWalletClient({account:owner,chain:mainnet,transport:http('http://127.0.0.1:8545')}).extend(morphoViemExtension({supportSignature:false}));
const vault=morpho.morpho.vaultV2(vaultAddress,1);
const deposit=vault.deposit({amount:100_000n,userAddress:owner.address,vaultData:await vault.getData()});
const calls=assertVaultDepositPlan({requirements:await deposit.getRequirements(),tx:deposit.buildTx(),vault:vaultAddress,token,amount:100_000n});
const usdcAbi=parseAbi(['function name() view returns (string)','function version() view returns (string)','function nonces(address) view returns (uint256)']);
const pmAbi=parseAbi(['function fetchPrice() view returns (uint256)','function feeSpread() view returns (uint32)','function additionalGasCharge() view returns (uint32)']);
const [name,version,permitNonce,nativeTokenPrice,spread,additional]=await Promise.all([
  client.readContract({address:token,abi:usdcAbi,functionName:'name'}),
  client.readContract({address:token,abi:usdcAbi,functionName:'version'}),
  client.readContract({address:token,abi:usdcAbi,functionName:'nonces',args:[owner.address]}),
  client.readContract({address:circlePaymaster,abi:pmAbi,functionName:'fetchPrice'}),
  client.readContract({address:circlePaymaster,abi:pmAbi,functionName:'feeSpread'}),
  client.readContract({address:circlePaymaster,abi:pmAbi,functionName:'additionalGasCharge'}),
]);
const nonce=await smart.getNonce();
const calldata=await smart.encodeCalls(calls);
const [beneficiary]=await client.request({method:'eth_accounts'});
if(!beneficiary||await client.getChainId()!==1) throw new Error('Start a local Anvil Ethereum-mainnet fork first');
const eventsAbi=parseAbi(['event UserOperationSponsored(address indexed token, address indexed sender, bytes32 userOpHash, uint256 nativeTokenPrice, uint256 actualTokenNeeded, uint256 feeTokenAmount)','event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)']);
let live;
try {
  const publicClient=createPublicClient({chain:mainnet,transport:http(process.env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com')});
  const [block,quote,price,liveBalance,livePermitNonce]=await Promise.all([
    publicClient.getBlock({blockTag:'latest'}),
    fetch('https://public.pimlico.io/v2/1/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'pimlico_getUserOperationGasPrice',params:[]})}).then(response=>response.json()),
    publicClient.readContract({address:circlePaymaster,abi:pmAbi,functionName:'fetchPrice'}),
    publicClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
    publicClient.readContract({address:token,abi:usdcAbi,functionName:'nonces',args:[owner.address]}),
  ]);
  if(!quote.result?.slow?.maxPriorityFeePerGas) throw new Error('Pimlico returned no slow priority fee');
  const fees=nextBlockBid(block,hexToBigInt(quote.result.slow.maxPriorityFeePerGas));
  live={block:block.number,fees,price,balance:liveBalance,stateMatches:livePermitNonce===permitNonce&&liveBalance===await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]})};
  console.log(JSON.stringify({liveQuoteBlock:String(live.block),maxFeePerGasWei:String(fees.maxFeePerGas),priorityFeePerGasWei:String(fees.maxPriorityFeePerGas),circlePriceAtomsPerEth:String(price),walletBalanceAtoms:String(liveBalance),walletStateMatchesFork:live.stateMatches}));
} catch(error) { console.log(JSON.stringify({liveProjectionUnavailable:String(error.message).slice(0,200)})); }

function inferBeforePostGas(actualTokenNeeded,gasPrice,postOpGasLimit,price) {
  const cost=gas=>circleFinalCharge({actualGasCostWei:gas*gasPrice,actualUserOpFeePerGas:gasPrice,postOpGasLimit},{nativeTokenPrice:price,feeSpread:BigInt(spread),additionalGasCharge:BigInt(additional)});
  let lo=0n,hi=10_000_000n;
  while(lo<hi) { const mid=(lo+hi)/2n; if(cost(mid)<actualTokenNeeded) lo=mid+1n; else hi=mid; }
  if(cost(lo)!==actualTokenNeeded) throw new Error('Could not infer Circle pre-postOp gas from receipt');
  return lo;
}

function maxFeeForTarget(operation,beforePostGas,pricing) {
  const refund=fee=>circleFeeCap({...operation,maxFeePerGas:fee},pricing)-circleFinalCharge({actualGasCostWei:beforePostGas*fee,actualUserOpFeePerGas:fee,postOpGasLimit:operation.paymasterPostOpGasLimit},pricing);
  let lo=1n,hi=100_000_000_000n;
  while(lo<hi) { const mid=(lo+hi+1n)/2n; if(refund(mid)<=100_000n) lo=mid; else hi=mid-1n; }
  return lo;
}
const configurations=[
  ['baseline',400000n,40000n,83360n,160000n,35000n],
  ['combined-380',380000n,40000n,83360n,120000n,35000n],
  ['combined-375',375000n,40000n,83360n,120000n,35000n],
  ['combined-378',378000n,40000n,83360n,120000n,35000n],
  ['ver-38',380000n,38000n,83360n,120000n,35000n],
  ['pm-118',380000n,40000n,83360n,118000n,35000n],
];
const chosen=configurations.filter(([label])=>!process.env.GAS_LAB_CASE||label===process.env.GAS_LAB_CASE);
if(chosen.length===0) throw new Error('Unknown GAS_LAB_CASE');
let snapshot=await client.request({method:'evm_snapshot',params:[]});
for(const [index,[label,callGasLimit,verificationGasLimit,preVerificationGas,paymasterVerificationGasLimit,paymasterPostOpGasLimit]] of chosen.entries()) {
  if(index>0) { await client.request({method:'evm_revert',params:[snapshot]}); snapshot=await client.request({method:'evm_snapshot',params:[]}); }
  const op={sender:owner.address,nonce,callData:calldata,callGasLimit,verificationGasLimit,preVerificationGas,paymasterVerificationGasLimit,paymasterPostOpGasLimit,maxFeePerGas:1_000_000_000n,maxPriorityFeePerGas:100_000_000n,paymaster:circlePaymaster};
  const feeCap=circleFeeCap(op,{nativeTokenPrice,feeSpread:BigInt(spread),additionalGasCharge:BigInt(additional)});
  const permit={types:{Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'Permit',domain:{name,version,chainId:1,verifyingContract:token},message:{owner:owner.address,spender:circlePaymaster,value:feeCap,nonce:permitNonce,deadline:maxUint256}};
  const permitSig=await owner.signTypedData(permit);
  op.paymasterData=encodePacked(['uint8','address','uint256','bytes'],[0,token,feeCap,permitSig]);
  op.signature=await smart.signUserOperation(op);
  const data=encodeFunctionData({abi:entryPoint08Abi,functionName:'handleOps',args:[[toPackedUserOperation(op)],beneficiary]});
  try {
    const hash=await client.request({method:'eth_sendTransaction',params:[{from:beneficiary,to:entryPoint08Address,data,gas:'0x989680'}]});
    const receipt=await client.waitForTransactionReceipt({hash});
    const events=parseEventLogs({abi:eventsAbi,logs:receipt.logs,strict:false});
    const sponsor=events.find(e=>e.eventName==='UserOperationSponsored');
    const operation=events.find(e=>e.eventName==='UserOperationEvent');
    const trace=receipt.status==='reverted'?await client.request({method:'debug_traceTransaction',params:[hash,{tracer:'callTracer'}]}):null;
    const passed=receipt.status==='success'&&operation?.args.success===true&&!!sponsor;
    let projection;
    if(passed) {
      const observedFee=operation.args.actualGasCost/operation.args.actualGasUsed;
      const beforePostGas=inferBeforePostGas(sponsor.args.actualTokenNeeded,observedFee,paymasterPostOpGasLimit,sponsor.args.nativeTokenPrice);
      projection={beforePostGas:String(beforePostGas)};
      if(live?.stateMatches) {
        const projectedOperation={...op,maxFeePerGas:live.fees.maxFeePerGas};
        const livePricing={nativeTokenPrice:live.price,feeSpread:BigInt(spread),additionalGasCharge:BigInt(additional)};
        const projectedHold=circleFeeCap(projectedOperation,livePricing);
        const projectedCharge=circleFinalCharge({actualGasCostWei:beforePostGas*live.fees.maxFeePerGas,actualUserOpFeePerGas:live.fees.maxFeePerGas,postOpGasLimit:paymasterPostOpGasLimit},livePricing);
        projection={...projection,quoteBlock:String(live.block),maxHoldAtoms:String(projectedHold),finalChargeAtoms:String(projectedCharge),refundAtoms:String(projectedHold-projectedCharge),maximumFeeForPointOneWei:String(maxFeeForTarget(op,beforePostGas,livePricing)),walletCanCoverHold:live.balance>projectedHold};
      }
    }
    console.log(JSON.stringify({label,limits:[callGasLimit,verificationGasLimit,preVerificationGas,paymasterVerificationGasLimit,paymasterPostOpGasLimit].map(String),totalLimits:String(callGasLimit+verificationGasLimit+preVerificationGas+paymasterVerificationGasLimit+paymasterPostOpGasLimit),feeCapAtoms:String(feeCap),passed,actualTokenNeededAtoms:sponsor&&String(sponsor.args.actualTokenNeeded),refundAtoms:passed?String(feeCap-sponsor.args.actualTokenNeeded):undefined,actualGasUsed:operation&&String(operation.args.actualGasUsed),projection,revert:trace&&{error:trace.error,output:trace.output,failedCalls:trace.calls?.filter(c=>c.error).map(c=>({to:c.to,error:c.error,output:c.output}))}}));
  } catch(error) { console.log(JSON.stringify({label,error:String(error.message).slice(0,400)})); }
}
