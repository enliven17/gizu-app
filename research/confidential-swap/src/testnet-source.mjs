import {mkdir, readFile, rename, writeFile, chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {createPublicClient, decodeFunctionData, erc20Abi, formatUnits, getAddress, http, parseEventLogs} from 'viem';
import {sepolia} from 'viem/chains';
import {privateKeyToAccount} from 'viem/accounts';
import {createPimlicoClient} from 'permissionless/clients/pimlico';
import {createSmartAccountClient} from 'permissionless';
import {prepareUserOperationForErc20Paymaster} from 'permissionless/experimental/pimlico';
import {entryPoint08Address, formatUserOperationRequest, getUserOperationHash, toSimple7702SmartAccount} from 'viem/account-abstraction';

const rpc='https://ethereum-sepolia-rpc.publicnode.com';
const bundlerRpc='https://public.pimlico.io/v2/11155111/rpc';
const token=getAddress('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238');
const amount=1_000_000n;
const maximumGas=2_000_000n;
const stateFile=join(process.cwd(),'.local','testnet-source-sepolia.json');
const client=createPublicClient({chain:sepolia,transport:http(rpc,{timeout:30_000})});
const bundlerRpcClient=createPublicClient({transport:http(bundlerRpc,{timeout:30_000})});
const pimlico=createPimlicoClient({chain:sepolia,transport:http(bundlerRpc,{timeout:30_000}),entryPoint:{address:entryPoint08Address,version:'0.8'}});

function need(name) { const value=process.env[name]?.trim(); if(!value) throw new Error(`Missing ${name}`); return value; }
function wallets() {
  const owner=privateKeyToAccount(need('SOURCE_PK'));
  if(owner.address!==getAddress(need('SOURCE_ADD'))) throw new Error('SOURCE_PK and SOURCE_ADD differ');
  const recipient=getAddress(need('DEST1_ADD'));
  if(recipient===owner.address) throw new Error('Recipient must differ from source');
  return {owner,recipient};
}
async function save(state) {
  await mkdir(join(process.cwd(),'.local'),{recursive:true,mode:0o700});
  const temp=`${stateFile}.${process.pid}.tmp`;
  await writeFile(temp,JSON.stringify(state,null,2),{mode:0o600});
  await chmod(temp,0o600);
  await rename(temp,stateFile);
}
async function prepare() {
  const {owner,recipient}=wallets();
  if(await client.getChainId()!==11155111) throw new Error('Wrong testnet RPC chain');
  if(await client.getBalance({address:owner.address})!==0n) throw new Error('Source has testnet ETH; zero-ETH paymaster proof requires none');
  const balance=await client.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]});
  if(balance<amount+maximumGas) throw new Error('Source needs at least 3 test USDC on Sepolia for the 1 USDC transfer and gas cap');
  const account=await toSimple7702SmartAccount({client,owner});
  if(account.address!==owner.address) throw new Error('Delegation changed source address');
  const code=await client.getCode({address:owner.address});
  const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
  if(code&&code!=='0x'&&code.toLowerCase()!==expected) throw new Error('Source has an unexpected delegation');
  const authorization=code&&code!=='0x'?undefined:await owner.signAuthorization({chainId:11155111,nonce:await client.getTransactionCount({address:owner.address}),contractAddress:account.authorization.address});
  const quotes=await pimlico.getTokenQuotes({tokens:[token],entryPointAddress:entryPoint08Address,chain:sepolia});
  if(quotes.length!==1||getAddress(quotes[0].token)!==token) throw new Error('No no-key Sepolia USDC paymaster quote');
  const paymaster=getAddress(quotes[0].paymaster);
  const fees=(await pimlico.getUserOperationGasPrice()).standard;
  const bundler=createSmartAccountClient({account,client,chain:sepolia,bundlerTransport:http(bundlerRpc,{timeout:30_000}),paymaster:pimlico,
    userOperation:{estimateFeesPerGas:async()=>fees,prepareUserOperation:prepareUserOperationForErc20Paymaster(pimlico)}});
  const prepared=await bundler.prepareUserOperation({account,authorization,paymasterContext:{token},
    calls:[{to:token,abi:erc20Abi,functionName:'transfer',args:[recipient,amount]}]});
  if(getAddress(prepared.sender)!==owner.address||getAddress(prepared.paymaster)!==paymaster) throw new Error('Unexpected sender or paymaster');
  const calls=await account.decodeCalls(prepared.callData);
  const transfer=calls.at(-1);
  const decoded=decodeFunctionData({abi:erc20Abi,data:transfer.data});
  if(getAddress(transfer.to)!==token||decoded.functionName!=='transfer'||getAddress(decoded.args[0])!==recipient||decoded.args[1]!==amount) throw new Error('Prepared transfer changed');
  const {costInToken}=await pimlico.estimateErc20PaymasterCost({userOperation:prepared,token,entryPoint:account.entryPoint});
  if(costInToken<=0n||costInToken>maximumGas||balance<amount+costInToken) throw new Error(`USDC gas estimate ${formatUnits(costInToken,6)} exceeds the 2 USDC test cap or the source balance ${formatUnits(balance,6)}`);
  if(calls.length<1||calls.length>2) throw new Error('Unexpected call count');
  if(calls.length===2) {
    const approval=decodeFunctionData({abi:erc20Abi,data:calls[0].data});
    if(getAddress(calls[0].to)!==token||approval.functionName!=='approve'||getAddress(approval.args[0])!==paymaster||approval.args[1]!==costInToken) throw new Error('Approval differs from quoted gas cap');
  }
  return {owner,recipient,balance,account,prepared,costInToken,paymaster};
}

const command=process.argv[2];
try {
  if(command==='preview'||command==='send') {
    if(existsSync(stateFile)) throw new Error('A signed testnet operation already exists; run status before another send');
    const p=await prepare();
    if(command==='preview') {
      console.log(JSON.stringify({chainId:11155111,source:p.owner.address,recipient:p.recipient,transferUSDC:formatUnits(amount,6),maximumGasUSDC:formatUnits(p.costInToken,6),paymaster:p.paymaster,nativeGasHeld:'0',noApiKey:true},null,2));
    } else {
      const signature=await p.account.signUserOperation(p.prepared);
      const hash=getUserOperationHash({chainId:11155111,entryPointAddress:entryPoint08Address,entryPointVersion:'0.8',userOperation:{...p.prepared,signature}});
      const operation=formatUserOperationRequest({...p.prepared,signature});
      await save({status:'signed',hash,operation,source:p.owner.address,recipient:p.recipient,paymaster:p.paymaster,amountAtoms:amount.toString(),feeCapAtoms:p.costInToken.toString()});
      const returned=await bundlerRpcClient.request({method:'eth_sendUserOperation',params:[operation,entryPoint08Address]},{retryCount:0});
      if(returned.toLowerCase()!==hash.toLowerCase()) throw new Error('Bundler returned a different UserOperation hash');
      await save({status:'submitted',hash,operation,source:p.owner.address,recipient:p.recipient,paymaster:p.paymaster,amountAtoms:amount.toString(),feeCapAtoms:p.costInToken.toString()});
      console.log(JSON.stringify({status:'submitted',hash}));
    }
  } else if(command==='status') {
    if(!existsSync(stateFile)) throw new Error('No signed testnet operation');
    const state=JSON.parse(await readFile(stateFile,'utf8'));
    const receipt=await pimlico.getUserOperationReceipt({hash:state.hash}).catch(e=>e.name==='UserOperationReceiptNotFoundError'?null:Promise.reject(e));
    if(!receipt) console.log(JSON.stringify({status:state.status,hash:state.hash,receipt:null}));
    else {
      const tx=await client.getTransactionReceipt({hash:receipt.receipt.transactionHash});
      const transfers=parseEventLogs({abi:[{type:'event',name:'Transfer',inputs:[{indexed:true,name:'from',type:'address'},{indexed:true,name:'to',type:'address'},{indexed:false,name:'value',type:'uint256'}]}],logs:tx.logs,strict:false});
      const sent=transfers.filter(x=>getAddress(x.address)===token&&getAddress(x.args.from)===getAddress(state.source)&&getAddress(x.args.to)===getAddress(state.recipient)&&x.args.value===amount);
      console.log(JSON.stringify({status:receipt.success&&tx.status==='success'&&sent.length===1?'confirmed':'needs_reconciliation',hash:state.hash,transactionHash:tx.transactionHash,transferLogCount:sent.length,nativeGasHeld:formatUnits(await client.getBalance({address:state.source}),18)}));
    }
  } else throw new Error('Use preview, send or status');
} catch(error) { console.error(error.message); process.exitCode=1; }
