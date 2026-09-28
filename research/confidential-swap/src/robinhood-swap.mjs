import {createPublicClient, decodeFunctionData, defineChain, erc20Abi, getAddress, http} from 'viem';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';
import {prepareUserOperationForErc20Paymaster} from 'permissionless/experimental/pimlico';
import {entryPoint08Address, formatUserOperationRequest, getUserOperationHash, toSimple7702SmartAccount} from 'viem/account-abstraction';
import {signedErc20FeeCap} from './source-paymaster.mjs';
import {swapAmount, validateRouterQuote} from './core.mjs';

export const robinhoodChainId=4663;
export const robinhood=defineChain({id:robinhoodChainId,name:'Robinhood Chain',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://rpc.mainnet.chain.robinhood.com']}}});
export const oneInchRouter=getAddress(process.env.SWAP_ROUTER?.trim()||'0x111111125421cA6dc452d289314280a0f8842A65');
const paymasterAddress=getAddress('0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402');

function pimlicoRpc() {
  const key=process.env.PIMLICO_API_KEY?.trim();
  if(!key) throw new Error('Missing PIMLICO_API_KEY in .env');
  return `https://api.pimlico.io/v2/${robinhoodChainId}/rpc?apikey=${encodeURIComponent(key)}`;
}

export async function oneInch(path,params) {
  const key=process.env.ONEINCH_API_KEY?.trim();
  if(!key) throw new Error('Missing ONEINCH_API_KEY in .env');
  const url=new URL(`https://api.1inch.dev/swap/v6.1/${robinhoodChainId}/${path}`);
  for(const [name,value] of Object.entries(params)) url.searchParams.set(name,String(value));
  const response=await fetch(url,{headers:{Authorization:`Bearer ${key}`,accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`1inch ${path} failed: ${response.status} ${response.statusText}`);
  return response.json();
}

export async function routerSwap({src,dst,amount,wallet,slippageBps}) {
  const response=await oneInch('swap',{src,dst,amount,from:wallet,origin:wallet,receiver:wallet,slippage:slippageBps/100,disableEstimate:true,includeTokensInfo:true});
  return validateRouterQuote(response,{router:oneInchRouter,srcToken:src,dstToken:dst,receiver:wallet,amountIn:amount,slippageBps});
}

export async function createRobinhoodPaymaster({client,owner,token}) {
  const rpc=pimlicoRpc();
  if((await client.getChainId())!==robinhoodChainId) throw new Error('Expected Robinhood Chain mainnet');
  const account=await toSimple7702SmartAccount({client,owner});
  if(account.address!==owner.address) throw new Error('7702 changed the destination address');
  const code=await client.getCode({address:owner.address});
  const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
  if(code && code!=='0x' && code.toLowerCase()!==expected) throw new Error('Destination EOA has an unknown delegation');
  const authorization=code && code!=='0x' ? undefined : await owner.signAuthorization({chainId:robinhoodChainId,nonce:await client.getTransactionCount({address:owner.address}),contractAddress:account.authorization.address});
  const pimlico=createPimlicoClient({chain:robinhood,transport:http(rpc,{timeout:30_000}),entryPoint:{address:entryPoint08Address,version:'0.8'}});
  const [entryPoints,quote,contractCode]=await Promise.all([
    pimlico.getSupportedEntryPoints(),
    pimlico.getTokenQuotes({tokens:[token],entryPointAddress:entryPoint08Address,chain:robinhood}),
    client.getCode({address:paymasterAddress}),
  ]);
  if(!entryPoints.some(x=>x.toLowerCase()===entryPoint08Address.toLowerCase())) throw new Error('Robinhood bundler lacks EntryPoint v0.8');
  if(!contractCode || contractCode==='0x') throw new Error('Robinhood ERC-20 paymaster is not deployed');
  if(quote.length!==1 || getAddress(quote[0].paymaster)!==paymasterAddress || getAddress(quote[0].token)!==getAddress(token)) throw new Error('No USDG gas quote from the Robinhood ERC-20 paymaster; the swap cannot pay gas in USDG. No operation was signed.');
  const fees=(await pimlico.getUserOperationGasPrice()).standard;
  const bundler=createSmartAccountClient({account,client,chain:robinhood,bundlerTransport:http(rpc,{timeout:30_000}),paymaster:pimlico,
    userOperation:{estimateFeesPerGas:async()=>fees,prepareUserOperation:prepareUserOperationForErc20Paymaster(pimlico)}});
  return {account,authorization,bundler,pimlico,paymasterAddress,token:getAddress(token)};
}

export async function prepareSwap(context,{target,route}) {
  const token=context.token;
  const prepared=await context.bundler.prepareUserOperation({account:context.account,authorization:context.authorization,paymasterContext:{token},
    calls:[{to:token,abi:erc20Abi,functionName:'approve',args:[route.to,route.amountIn]},{to:route.to,data:route.data}]});
  if(getAddress(prepared.sender)!==context.account.address || getAddress(prepared.paymaster)!==context.paymasterAddress) throw new Error('Unexpected UserOperation sender or paymaster');
  const calls=await context.account.decodeCalls(prepared.callData);
  if(calls.length<2||calls.length>3) throw new Error('Unexpected swap call count');
  const costInToken=signedErc20FeeCap(prepared,token);
  const [swapCall,routerApproval]=[calls.at(-1),calls.at(-2)];
  const approval=decodeFunctionData({abi:erc20Abi,data:routerApproval.data});
  if(getAddress(routerApproval.to)!==token||approval.functionName!=='approve'||getAddress(approval.args[0])!==route.to||approval.args[1]!==route.amountIn) throw new Error('Prepared router approval differs from the approved swap');
  if(getAddress(swapCall.to)!==route.to||swapCall.data!==route.data||BigInt(swapCall.value??0n)!==0n) throw new Error('Prepared router call differs from the validated calldata');
  if(calls.length===3) {
    const gasApproval=decodeFunctionData({abi:erc20Abi,data:calls[0].data});
    if(getAddress(calls[0].to)!==token||gasApproval.functionName!=='approve'||getAddress(gasApproval.args[0])!==context.paymasterAddress||gasApproval.args[1]!==costInToken) throw new Error(`USDG gas approval ${gasApproval.args[1]} differs from signed fee cap ${costInToken}`);
  } else {
    const allowance=await context.account.client.readContract({address:token,abi:erc20Abi,functionName:'allowance',args:[context.account.address,context.paymasterAddress]});
    if(allowance<costInToken) throw new Error('Existing USDG paymaster allowance is below signed fee cap');
  }
  return {prepared,feeCapAtoms:costInToken,target:getAddress(target)};
}

// The swap input depends on the fee cap and the fee cap on the calldata, so both are re-derived until they agree.
export async function prepareSwapForBalance(context,{balance,target,slippageBps}) {
  let feeCap=0n;
  for(let attempt=0;attempt<4;attempt++) {
    const amountIn=attempt===0?balance-1n:swapAmount(balance,feeCap);
    const route={...await routerSwap({src:context.token,dst:target,amount:amountIn,wallet:context.account.address,slippageBps}),amountIn};
    const operation=await prepareSwap(context,{target,route});
    if(attempt>0&&operation.feeCapAtoms===feeCap) return {...operation,route};
    feeCap=operation.feeCapAtoms;
    swapAmount(balance,feeCap);
  }
  throw new Error('USDG paymaster fee did not stabilize; no swap operation was signed');
}

export async function signSwap(context,prepared) {
  const signature=await context.account.signUserOperation(prepared);
  const userOperationHash=getUserOperationHash({chainId:robinhoodChainId,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:{...prepared,signature}});
  return {userOperationHash,rpcOperation:formatUserOperationRequest({...prepared,signature})};
}

export async function submitSwap(signed) {
  const client=createPublicClient({transport:http(pimlicoRpc(),{timeout:30_000})});
  const returned=await client.request({method:'eth_sendUserOperation',params:[signed.rpcOperation,entryPoint08Address]},{retryCount:0});
  if(returned.toLowerCase()!==signed.userOperationHash.toLowerCase()) throw new Error('Bundler returned an unexpected UserOperation hash');
  return returned;
}

export async function swapReceipt(hash) {
  const client=createPimlicoClient({transport:http(pimlicoRpc(),{timeout:30_000}),entryPoint:{address:entryPoint08Address,version:'0.8'}});
  return client.getUserOperationReceipt({hash}).catch(error=>error.name==='UserOperationReceiptNotFoundError'?null:Promise.reject(error));
}
