import {createPublicClient, decodeFunctionData, encodePacked, erc20Abi, getAddress, hexToBigInt, http, maxUint256, parseAbi, verifyTypedData} from 'viem';
import {createBundlerClient, entryPoint08Address, formatUserOperationRequest, getUserOperationHash, toSimple7702SmartAccount} from 'viem/account-abstraction';

export const circlePaymaster=getAddress('0x0578cFB241215b77442a541325d6A4E6dFE700Ec');
const publicBundler='https://public.pimlico.io/v2/1/rpc';
const usdcExtraAbi=parseAbi(['function name() view returns (string)','function version() view returns (string)','function nonces(address) view returns (uint256)']);
const paymasterAbi=parseAbi(['function fetchPrice() view returns (uint256)','function feeSpread() view returns (uint32)','function additionalGasCharge() view returns (uint32)']);

export function circleFeeCap(operation,{nativeTokenPrice,feeSpread,additionalGasCharge}) {
  const gasLimit=operation.preVerificationGas+operation.verificationGasLimit+operation.callGasLimit+operation.paymasterVerificationGasLimit+operation.paymasterPostOpGasLimit;
  if(gasLimit<=0n||operation.maxFeePerGas<=0n||nativeTokenPrice<=0n||feeSpread<0n||feeSpread>10_000n) throw new Error('Invalid Circle paymaster fee inputs');
  const maxCost=gasLimit*operation.maxFeePerGas;
  const base=((maxCost+additionalGasCharge*operation.maxFeePerGas)*nativeTokenPrice)/10n**18n+1n;
  return base+(base*feeSpread)/10_000n;
}

export async function createCircleContext({client,chain,owner,recipient,token}) {
  if(chain.id!==1 || await client.getChainId()!==1) throw new Error('Expected Ethereum mainnet');
  const account=await toSimple7702SmartAccount({client,owner});
  if(account.address!==owner.address) throw new Error('7702 changed the A1 address');
  const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
  const [code,paymasterCode,implementationCode,tokenCode,balance,nativeBalance,name,version,permitNonce]=await Promise.all([
    client.getCode({address:owner.address}),client.getCode({address:circlePaymaster}),client.getCode({address:account.authorization.address}),client.getCode({address:token}),
    client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),
    client.getBalance({address:owner.address}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'name'}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'version'}),
    client.readContract({address:token,abi:usdcExtraAbi,functionName:'nonces',args:[owner.address]}),
  ]);
  if(code&&code!=='0x'&&code.toLowerCase()!==expected) throw new Error('A1 has an unknown delegation');
  if(!paymasterCode||paymasterCode==='0x'||!implementationCode||implementationCode==='0x'||!tokenCode||tokenCode==='0x') throw new Error('Required Ethereum contract is not deployed');
  if(nativeBalance!==0n) throw new Error('A1 holds ETH; this run cannot prove the zero-ETH paymaster path');
  const authorization=code&&code!=='0x'?undefined:await owner.signAuthorization({chainId:1,nonce:await client.getTransactionCount({address:owner.address}),contractAddress:account.authorization.address});
  const query=createBundlerClient({client,transport:http(publicBundler,{timeout:30_000})});
  const entries=await query.getSupportedEntryPoints();
  if(!entries.some(x=>x.toLowerCase()===entryPoint08Address.toLowerCase())) throw new Error('Public Ethereum bundler lacks EntryPoint v0.8');
  const {slow:fees}=await query.request({method:'pimlico_getUserOperationGasPrice'});
  const gasFees={maxFeePerGas:hexToBigInt(fees.maxFeePerGas),maxPriorityFeePerGas:hexToBigInt(fees.maxPriorityFeePerGas)};
  return {account,authorization,balance,client,chain,owner,recipient:getAddress(recipient),token:getAddress(token),name,version,permitNonce,gasFees};
}

async function circleBundler(context,permitAmount) {
  const permit={types:{Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]},primaryType:'Permit',
    domain:{name:context.name,version:context.version,chainId:1,verifyingContract:context.token},
    message:{owner:context.owner.address,spender:circlePaymaster,value:permitAmount,nonce:context.permitNonce,deadline:maxUint256}};
  const signature=await context.owner.signTypedData(permit);
  if(!await verifyTypedData({address:context.owner.address,...permit,signature})) throw new Error('USDC permit signature is invalid');
  const paymaster={async getPaymasterData(){return {paymaster:circlePaymaster,paymasterData:encodePacked(['uint8','address','uint256','bytes'],[0,context.token,permitAmount,signature]),paymasterVerificationGasLimit:200_000n,paymasterPostOpGasLimit:35_000n,isFinal:true};}};
  return createBundlerClient({account:context.account,client:context.client,paymaster,userOperation:{estimateFeesPerGas:async()=>context.gasFees},transport:http(publicBundler,{timeout:30_000})});
}

export async function prepareCircleTransfer(context) {
  if(context.balance<=0n) throw new Error('A1 has no USDC to transfer');
  const [nativeTokenPrice,feeSpread,additionalGasCharge]=await Promise.all(['fetchPrice','feeSpread','additionalGasCharge'].map(functionName=>context.client.readContract({address:circlePaymaster,abi:paymasterAbi,functionName})));
  const pricing={nativeTokenPrice,feeSpread:BigInt(feeSpread),additionalGasCharge:BigInt(additionalGasCharge)};
  let permitAmount=context.balance,amount=1n,prepared,feeCap;
  for(let attempt=0;attempt<6;attempt++) {
    const bundler=await circleBundler(context,permitAmount);
    prepared=await bundler.prepareUserOperation({account:context.account,authorization:context.authorization,
      calls:[{to:context.token,abi:erc20Abi,functionName:'transfer',args:[context.recipient,amount]}]});
    feeCap=circleFeeCap(prepared,pricing);
    if(feeCap>=context.balance) throw new Error(`A1 USDC balance ${context.balance} atoms cannot cover Circle paymaster maximum gas cost ${feeCap} atoms`);
    const nextAmount=context.balance-feeCap;
    if(permitAmount===feeCap&&amount===nextAmount) break;
    permitAmount=feeCap; amount=nextAmount;
    if(attempt===5) throw new Error('Circle USDC gas cost did not stabilize; no operation was signed');
  }
  if(getAddress(prepared.sender)!==context.owner.address||getAddress(prepared.paymaster)!==circlePaymaster) throw new Error('Unexpected Ethereum UserOperation sender or paymaster');
  const calls=await context.account.decodeCalls(prepared.callData);
  if(calls.length!==1||getAddress(calls[0].to)!==context.token) throw new Error('Unexpected Ethereum transfer call');
  const decoded=decodeFunctionData({abi:erc20Abi,data:calls[0].data});
  if(decoded.functionName!=='transfer'||getAddress(decoded.args[0])!==context.recipient||decoded.args[1]!==amount) throw new Error('Ethereum transfer differs from quoted amount');
  if(amount+feeCap!==context.balance||permitAmount!==feeCap) throw new Error('Circle maximum gas charge and transfer do not fit A1 balance');
  return {amount,feeCap,prepared};
}

export async function signCircleTransfer(context,prepared) {
  const signature=await context.account.signUserOperation(prepared);
  const userOperationHash=getUserOperationHash({chainId:1,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:{...prepared,signature}});
  return {userOperationHash,rpcOperation:formatUserOperationRequest({...prepared,signature})};
}

export async function submitCircleTransfer(signed) {
  const client=createPublicClient({transport:http(publicBundler,{timeout:30_000})});
  const returned=await client.request({method:'eth_sendUserOperation',params:[signed.rpcOperation,entryPoint08Address]},{retryCount:0});
  if(returned.toLowerCase()!==signed.userOperationHash.toLowerCase()) throw new Error('Ethereum bundler returned an unexpected hash');
  return returned;
}

export async function circleTransferReceipt(hash) {
  const client=createBundlerClient({transport:http(publicBundler,{timeout:30_000})});
  return client.getUserOperationReceipt({hash}).catch(error=>error.name==='UserOperationReceiptNotFoundError'?null:Promise.reject(error));
}
