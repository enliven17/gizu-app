import {createPublicClient, createWalletClient, decodeFunctionData, encodePacked, erc20Abi, getAddress, hexToBigInt, http, maxUint256, parseAbi, verifyTypedData} from 'viem';
import {createBundlerClient, entryPoint08Address, formatUserOperationRequest, getUserOperationHash, toSimple7702SmartAccount} from 'viem/account-abstraction';
import {isRequirementApproval, morphoViemExtension} from '@morpho-org/morpho-sdk';
import {assertBidBlock, nextBlockBid, priorityFromFeeHistory} from './ethereum-fee.mjs';
import {assertCircleResidualBound} from './residual-policy.mjs';

export const vaultAddress=getAddress('0x55C1B6e461a6334B567bAF0FEb5D728715446f05');
export const circlePaymaster=getAddress('0x0578cFB241215b77442a541325d6A4E6dFE700Ec');
const bundlerUrls={pimlico:'https://public.pimlico.io/v2/1/rpc',candide:'https://api.candide.dev/public/v3/1'};
export function resolveEthereumBundler(id='pimlico') {
  if(!Object.hasOwn(bundlerUrls,id)) throw new Error(`Unknown Ethereum bundler ${id}`);
  return {id,url:bundlerUrls[id]};
}
export function resolveEthereumEstimator(_relayId='pimlico') {
  return resolveEthereumBundler('pimlico');
}
const usdcExtraAbi=parseAbi(['function name() view returns (string)','function version() view returns (string)','function nonces(address) view returns (uint256)']);
const vaultAbi=parseAbi(['function asset() view returns (address)']);
const paymasterAbi=parseAbi(['function fetchPrice() view returns (uint256)','function feeSpread() view returns (uint32)','function additionalGasCharge() view returns (uint32)']);

export function circleFeeCap(operation,{nativeTokenPrice,feeSpread,additionalGasCharge}) {
  const gasLimit=operation.preVerificationGas+operation.verificationGasLimit+operation.callGasLimit+operation.paymasterVerificationGasLimit+operation.paymasterPostOpGasLimit;
  if(gasLimit<=0n||operation.maxFeePerGas<=0n||nativeTokenPrice<=0n||feeSpread<0n||feeSpread>10_000n) throw new Error('Invalid Circle paymaster fee inputs');
  if(operation.paymasterPostOpGasLimit<additionalGasCharge) throw new Error('Circle post-operation gas limit is below its required additional charge');
  const maxCost=gasLimit*operation.maxFeePerGas;
  const base=((maxCost+additionalGasCharge*operation.maxFeePerGas)*nativeTokenPrice)/10n**18n+1n;
  return base+(base*feeSpread)/10_000n;
}

export function circleFinalCharge({actualGasCostWei,actualUserOpFeePerGas,postOpGasLimit},{nativeTokenPrice,feeSpread,additionalGasCharge}) {
  if(actualGasCostWei<0n||actualUserOpFeePerGas<=0n||postOpGasLimit<additionalGasCharge||nativeTokenPrice<=0n||feeSpread<0n||feeSpread>10_000n) throw new Error('Invalid Circle final charge inputs');
  const postOpUnusedGasPenalty=postOpGasLimit<=40_000n?0n:(postOpGasLimit-additionalGasCharge)/10n;
  const gasCost=actualGasCostWei+(additionalGasCharge+postOpUnusedGasPenalty)*actualUserOpFeePerGas;
  const base=gasCost*nativeTokenPrice/10n**18n+1n;
  return base+base*feeSpread/10_000n;
}

export function assertVaultDepositPlan({requirements,tx,vault,token,amount}) {
  if(tx?.action?.type!=='vaultV2Deposit'||getAddress(tx.action.args.vault)!==getAddress(vault)) throw new Error('Morpho SDK transaction targets the wrong vault');
  if(tx.action.args.amount!==amount||amount<=0n) throw new Error('Morpho SDK deposit amount differs from approved amount');
  if(tx.value!==0n||!tx.to||!tx.data) throw new Error('Expected an ERC-20 vault deposit transaction');
  const calls=[];
  for(const requirement of requirements) {
    if(!isRequirementApproval(requirement)||getAddress(requirement.to)!==getAddress(token)||requirement.value!==0n) throw new Error('Unexpected Morpho SDK prerequisite');
    const approval=decodeFunctionData({abi:erc20Abi,data:requirement.data});
    if(approval.functionName!=='approve'||getAddress(approval.args[0])!==getAddress(tx.to)||approval.args[1]!==requirement.action.args.amount||approval.args[1]!==0n&&approval.args[1]<amount) throw new Error('Unexpected Morpho SDK approval');
    calls.push({to:requirement.to,data:requirement.data,value:0n});
  }
  calls.push({to:tx.to,data:tx.data,value:0n});
  return calls;
}

export async function createVaultContext({client,chain,owner,token,rpc,bundlerId=process.env.ETHEREUM_BUNDLER||'pimlico'}) {
  if(chain.id!==1 || await client.getChainId()!==1) throw new Error('Expected Ethereum mainnet');
  const account=await toSimple7702SmartAccount({client,owner});
  if(account.address!==owner.address) throw new Error('7702 changed the destination address');
  const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
  const [code,paymasterCode,implementationCode,tokenCode,vaultCode,balance,nativeBalance,beforeShares,name,version,permitNonce,underlying]=await Promise.all([
    client.getCode({address:owner.address}),client.getCode({address:circlePaymaster}),client.getCode({address:account.authorization.address}),client.getCode({address:token}),client.getCode({address:vaultAddress}),
    client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
    client.getBalance({address:owner.address}),
    client.readContract({address:vaultAddress,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'name'}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'version'}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'nonces',args:[owner.address]}),
    client.readContract({address:vaultAddress,abi:vaultAbi,functionName:'asset'}),
  ]);
  if(code&&code!=='0x'&&code.toLowerCase()!==expected) throw new Error('Destination has an unknown delegation');
  if(!paymasterCode||paymasterCode==='0x'||!implementationCode||implementationCode==='0x'||!tokenCode||tokenCode==='0x'||!vaultCode||vaultCode==='0x') throw new Error('Required Ethereum contract is not deployed');
  if(getAddress(underlying)!==getAddress(token)) throw new Error('Morpho vault underlying asset is not Ethereum USDC');
  const authorization=code&&code!=='0x'?undefined:await owner.signAuthorization({chainId:1,nonce:await client.getTransactionCount({address:owner.address}),contractAddress:account.authorization.address});
  const bundler=resolveEthereumBundler(bundlerId);
  const estimator=resolveEthereumEstimator(bundler.id);
  const query=createBundlerClient({client,transport:http(bundler.url,{timeout:30_000})});
  const estimateQuery=createBundlerClient({client,transport:http(estimator.url,{timeout:30_000})});
  const [entries,estimatorEntries,feeBlock,quotes]=await Promise.all([query.getSupportedEntryPoints(),estimateQuery.getSupportedEntryPoints(),client.getBlock({blockTag:'latest'}),bundler.id==='pimlico'?query.request({method:'pimlico_getUserOperationGasPrice'}):null]);
  if(!entries.some(x=>x.toLowerCase()===entryPoint08Address.toLowerCase())) throw new Error(`${bundler.id} Ethereum bundler lacks EntryPoint v0.8`);
  if(!estimatorEntries.some(x=>x.toLowerCase()===entryPoint08Address.toLowerCase())) throw new Error('Ethereum gas estimator lacks EntryPoint v0.8');
  const history=await client.getFeeHistory({blockCount:8,blockNumber:feeBlock.number,rewardPercentiles:[20]});
  const gasFees=nextBlockBid(feeBlock,priorityFromFeeHistory(history));
  const morphoClient=createWalletClient({account:owner,chain,transport:http(rpc)}).extend(morphoViemExtension({supportSignature:false}));
  const vault=morphoClient.morpho.vaultV2(vaultAddress,1);
  const vaultData=await vault.getData();
  if(getAddress(vaultData.asset)!==getAddress(token)) throw new Error('Morpho SDK vault asset differs from Ethereum USDC');
  const bundlerFeeFloor=quotes?{maxFeePerGas:hexToBigInt(quotes.slow.maxFeePerGas),maxPriorityFeePerGas:hexToBigInt(quotes.slow.maxPriorityFeePerGas)}:null;
  return {account,authorization,balance,nativeBalance,beforeShares,client,chain,owner,token:getAddress(token),name,version,permitNonce,gasFees,bundler,estimator,bundlerFeeFloor,feeBlockNumber:feeBlock.number,vault,vaultData};
}

async function circleBundler(context,permitAmount) {
  const permit={types:{Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'Permit',
    domain:{name:context.name,version:context.version,chainId:1,verifyingContract:context.token},
    message:{owner:context.owner.address,spender:circlePaymaster,value:permitAmount,nonce:context.permitNonce,deadline:maxUint256}};
  const signature=await context.owner.signTypedData(permit);
  if(!await verifyTypedData({address:context.owner.address,...permit,signature})) throw new Error('USDC permit signature is invalid');
  const paymaster={async getPaymasterData(){return {paymaster:circlePaymaster,paymasterData:encodePacked(['uint8','address','uint256','bytes'],[0,context.token,permitAmount,signature]),paymasterVerificationGasLimit:200_000n,paymasterPostOpGasLimit:35_000n,isFinal:true};}};
  return createBundlerClient({account:context.account,client:context.client,paymaster,userOperation:{estimateFeesPerGas:async()=>context.gasFees},transport:http(context.estimator.url,{timeout:30_000})});
}

export function vaultPreparationRequest({account,authorization,calls,nonce}) {
  return {account,...(authorization?{authorization}:{}),calls,...(nonce===undefined?{}:{nonce})};
}

export function applyVerificationGasFloor(prepared,floor) {
  return floor!==undefined&&prepared.verificationGasLimit<floor?{...prepared,verificationGasLimit:floor}:prepared;
}

export async function prepareVaultDeposit(context,{nonce}={}) {
  if(context.balance<=0n) throw new Error('Destination has no USDC to deposit');
  const [nativeTokenPrice,feeSpread,additionalGasCharge]=await Promise.all(['fetchPrice','feeSpread','additionalGasCharge'].map(functionName=>context.client.readContract({address:circlePaymaster,abi:paymasterAbi,functionName})));
  const pricing={nativeTokenPrice,feeSpread:BigInt(feeSpread),additionalGasCharge:BigInt(additionalGasCharge)};
  let permitAmount=context.balance,amount=1n,prepared,feeCap,calls;
  for(let attempt=0;attempt<6;attempt++) {
    const deposit=context.vault.deposit({amount,userAddress:context.owner.address,vaultData:context.vaultData});
    const requirements=await deposit.getRequirements();
    calls=assertVaultDepositPlan({requirements,tx:deposit.buildTx(),vault:vaultAddress,token:context.token,amount});
    const bundler=await circleBundler(context,permitAmount);
    prepared=applyVerificationGasFloor(await bundler.prepareUserOperation(vaultPreparationRequest({account:context.account,authorization:context.authorization,calls,nonce})),context.minimumVerificationGasLimit);
    feeCap=circleFeeCap(prepared,pricing);
    if(feeCap>=context.balance) throw new Error(`Destination USDC balance ${context.balance} atoms cannot cover Circle paymaster maximum gas cost ${feeCap} atoms`);
    const nextAmount=context.balance-feeCap;
    if(permitAmount===feeCap&&amount===nextAmount) break;
    permitAmount=feeCap; amount=nextAmount;
    if(attempt===5) throw new Error('Circle vault deposit fee did not stabilize; no operation was signed');
  }
  if(getAddress(prepared.sender)!==context.owner.address||getAddress(prepared.paymaster)!==circlePaymaster) throw new Error('Unexpected Ethereum UserOperation sender or paymaster');
  const decoded=await context.account.decodeCalls(prepared.callData);
  if(decoded.length!==calls.length||decoded.some((call,i)=>getAddress(call.to)!==getAddress(calls[i].to)||call.data!==calls[i].data||(call.value??0n)!==0n)) throw new Error('Prepared vault calls differ from Morpho SDK plan');
  if(amount+feeCap!==context.balance||permitAmount!==feeCap) throw new Error('Vault deposit and maximum gas charge do not fit destination balance');
  return {amount,feeCap,prepared};
}

export async function signVaultDeposit(context,prepared,{amount}={}) {
  assertCircleResidualBound({balance:context.balance,amount});
  assertBidBlock(context.feeBlockNumber,await context.client.getBlockNumber());
  const currentBalance=await context.client.readContract({address:context.token,abi:erc20Abi,functionName:'balanceOf',args:[context.owner.address]});
  if(currentBalance!==context.balance) throw new Error('Destination USDC balance changed after the residual check; prepare again');
  const signature=await context.account.signUserOperation(prepared);
  const userOperationHash=getUserOperationHash({chainId:1,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:{...prepared,signature}});
  return {userOperationHash,bundlerId:context.bundler.id,beforeBalanceAtoms:context.balance.toString(),depositAtoms:amount.toString(),rpcOperation:formatUserOperationRequest({...prepared,signature})};
}

export async function submitVaultDeposit(signed) {
  if(signed.beforeBalanceAtoms===undefined||signed.depositAtoms===undefined) throw new Error('Saved operation has no residual bound; prepare and check it again');
  assertCircleResidualBound({balance:BigInt(signed.beforeBalanceAtoms),amount:BigInt(signed.depositAtoms)});
  const client=createPublicClient({transport:http(resolveEthereumBundler(signed.bundlerId).url,{timeout:30_000})});
  const returned=await client.request({method:'eth_sendUserOperation',params:[signed.rpcOperation,entryPoint08Address]},{retryCount:0});
  if(returned.toLowerCase()!==signed.userOperationHash.toLowerCase()) throw new Error('Ethereum bundler returned an unexpected hash');
  return returned;
}

export async function vaultDepositReceipt(hash,bundlerId='pimlico') {
  const client=createBundlerClient({transport:http(resolveEthereumBundler(bundlerId).url,{timeout:30_000})});
  return client.getUserOperationReceipt({hash}).catch(error=>error.name==='UserOperationReceiptNotFoundError'?null:Promise.reject(error));
}
