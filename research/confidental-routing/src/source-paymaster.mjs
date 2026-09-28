import {createPublicClient, decodeFunctionData, erc20Abi, getAddress, http, size, sliceHex} from 'viem';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';
import {prepareUserOperationForErc20Paymaster} from 'permissionless/experimental/pimlico';
import {entryPoint08Address, formatUserOperationRequest, getUserOperationHash, toSimple7702SmartAccount} from 'viem/account-abstraction';

const paymasterAddress=getAddress('0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402');
function pimlicoRpc() {
  const key=process.env.PIMLICO_API_KEY?.trim();
  if(!key) throw new Error('Missing PIMLICO_API_KEY in .env');
  return `https://api.pimlico.io/v2/143/rpc?apikey=${encodeURIComponent(key)}`;
}

export function sourceBudget(balance) {
  if(typeof balance!=='bigint'||balance<=0n) throw new Error('Source has no USDC to route');
  return balance<10_000_000n?balance:10_000_000n;
}

export function fundingAmount(budget,fee) {
  if(typeof budget!=='bigint'||typeof fee!=='bigint'||budget<=0n||fee<0n||fee>=budget) throw new Error('USDC paymaster fee consumes the source budget');
  return budget-fee;
}

export function signedErc20FeeCap(operation,token) {
  const data=operation.paymasterData;
  if(!data||size(data)<182) throw new Error('Invalid signed ERC-20 paymaster data');
  const mode=Number(BigInt(sliceHex(data,0,1)))>>1;
  if(mode!==1||getAddress(sliceHex(data,14,34))!==getAddress(token)) throw new Error('Signed paymaster data uses an unexpected mode or token');
  const postOpGas=BigInt(sliceHex(data,34,50));
  const exchangeRate=BigInt(sliceHex(data,50,82));
  const requiredGas=operation.preVerificationGas+operation.callGasLimit+operation.verificationGasLimit+operation.paymasterPostOpGasLimit+operation.paymasterVerificationGasLimit;
  const cost=(requiredGas+postOpGas)*operation.maxFeePerGas*exchangeRate/10n**18n;
  if(cost<=0n) throw new Error('Invalid signed USDC gas cost');
  return cost;
}

export async function createMonadPaymaster({chain,client,owner,token}) {
  const rpc=pimlicoRpc();
  if(chain.id!==143 || (await client.getChainId())!==143) throw new Error('Expected Monad mainnet');
  const account=await toSimple7702SmartAccount({client,owner});
  if(account.address!==owner.address) throw new Error('7702 changed the source address');
  const code=await client.getCode({address:owner.address});
  const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
  if(code && code!=='0x' && code.toLowerCase()!==expected) throw new Error('Source EOA has an unknown delegation');
  const authorization=code && code!=='0x' ? undefined : await owner.signAuthorization({chainId:143,nonce:await client.getTransactionCount({address:owner.address}),contractAddress:account.authorization.address});
  const pimlico=createPimlicoClient({chain,transport:http(rpc,{timeout:30_000}),entryPoint:{address:entryPoint08Address,version:'0.8'}});
  const [entryPoints,quote,contractCode]=await Promise.all([
    pimlico.getSupportedEntryPoints(),
    pimlico.getTokenQuotes({tokens:[token],entryPointAddress:entryPoint08Address,chain}),
    client.getCode({address:paymasterAddress}),
  ]);
  if(!entryPoints.some(x=>x.toLowerCase()===entryPoint08Address.toLowerCase())) throw new Error('Monad bundler lacks EntryPoint v0.8');
  if(!contractCode || contractCode==='0x') throw new Error('Monad ERC-20 paymaster is not deployed');
  if(quote.length!==1 || getAddress(quote[0].paymaster)!==paymasterAddress || getAddress(quote[0].token)!==getAddress(token)) throw new Error('Monad USDC paymaster quote is unavailable');
  const fees=(await pimlico.getUserOperationGasPrice()).standard;
  const bundler=createSmartAccountClient({account,client,chain,bundlerTransport:http(rpc,{timeout:30_000}),paymaster:pimlico,
    userOperation:{estimateFeesPerGas:async()=>fees,prepareUserOperation:prepareUserOperationForErc20Paymaster(pimlico)}});
  return {account,authorization,bundler,pimlico,paymasterAddress};
}

export async function prepareMonadFunding(context,{token,recipient,amount}) {
  if(amount<=0n) throw new Error('Funding amount must be positive');
  const prepared=await context.bundler.prepareUserOperation({account:context.account,authorization:context.authorization,paymasterContext:{token},
    calls:[{to:token,abi:erc20Abi,functionName:'transfer',args:[getAddress(recipient),amount]}]});
  if(getAddress(prepared.sender)!==context.account.address || getAddress(prepared.paymaster)!==context.paymasterAddress) throw new Error('Unexpected UserOperation sender or paymaster');
  const calls=await context.account.decodeCalls(prepared.callData);
  const transfer=calls.at(-1);
  const decoded=decodeFunctionData({abi:erc20Abi,data:transfer.data});
  if(getAddress(transfer.to)!==getAddress(token)||decoded.functionName!=='transfer'||getAddress(decoded.args[0])!==getAddress(recipient)||decoded.args[1]!==amount) throw new Error('Prepared funding call differs from quote');
  const costInToken=signedErc20FeeCap(prepared,token);
  if(calls.length<1||calls.length>2) throw new Error('Unexpected funding call count');
  if(calls.length===2) {
    const approval=decodeFunctionData({abi:erc20Abi,data:calls[0].data});
    if(getAddress(calls[0].to)!==getAddress(token)||approval.functionName!=='approve'||getAddress(approval.args[0])!==context.paymasterAddress||approval.args[1]!==costInToken) throw new Error(`USDC gas approval ${approval.args[1]} differs from signed fee cap ${costInToken}`);
  } else {
    const allowance=await context.account.client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[context.account.address,context.paymasterAddress]});
    if(allowance<costInToken) throw new Error('Existing USDC paymaster allowance is below signed fee cap');
  }
  return {prepared,feeCapAtoms:costInToken};
}

export async function signMonadFunding(context,prepared) {
  const signature=await context.account.signUserOperation(prepared);
  const userOperationHash=getUserOperationHash({chainId:143,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:{...prepared,signature}});
  return {userOperationHash,rpcOperation:formatUserOperationRequest({...prepared,signature})};
}

export async function submitMonadFunding(signed) {
  const client=createPublicClient({transport:http(pimlicoRpc(),{timeout:30_000})});
  const returned=await client.request({method:'eth_sendUserOperation',params:[signed.rpcOperation,entryPoint08Address]},{retryCount:0});
  if(returned.toLowerCase()!==signed.userOperationHash.toLowerCase()) throw new Error('Bundler returned an unexpected UserOperation hash');
  return returned;
}

export async function monadFundingReceipt(hash) {
  const client=createPimlicoClient({transport:http(pimlicoRpc(),{timeout:30_000}),entryPoint:{address:entryPoint08Address,version:'0.8'}});
  return client.getUserOperationReceipt({hash}).catch(error=>error.name==='UserOperationReceiptNotFoundError'?null:Promise.reject(error));
}
