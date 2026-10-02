import { createPublicClient, decodeFunctionData, defineChain, encodeFunctionData, erc20Abi, getAddress, http, type Address, type Hex } from "viem";
import { entryPoint08Address, formatUserOperationRequest, toSimple7702SmartAccount } from "viem/account-abstraction";
import { toAccount, type PrivateKeyAccount } from "viem/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { createSmartAccountClient } from "permissionless";
import { prepareUserOperationForErc20Paymaster } from "permissionless/experimental/pimlico";
import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";

export const monadUsdc = getAddress("0x754704Bc059F8C67012fEd69BC8A327a5aafb603");
export const tokenPaymaster = getAddress("0x888888888888Ec68A58AB8094Cc1AD20Ba3D2402");
const monad = defineChain({id:143,name:"Monad",nativeCurrency:{name:"MON",symbol:"MON",decimals:18},rpcUrls:{default:{http:["https://rpc.monad.xyz"]}}});
const max=(1n<<256n)-1n;
const gasFields=["preVerificationGas","callGasLimit","verificationGasLimit","paymasterPostOpGasLimit","paymasterVerificationGasLimit"] as const;
type GasField=typeof gasFields[number];
export type FundingOperation = Partial<Record<GasField,bigint>> & {
  sender: Address; paymaster?: Address; nonce: bigint; callData: Hex;
  maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; paymasterData?: Hex;
  factory?: Address; factoryData?: Hex;
};
export type FundingCall={to:Address;data?:Hex;value?:bigint};
function uint(n:unknown,positive=false):bigint {
  if(typeof n!=="bigint"||n<0n||n>max||(positive&&n===0n)) throw new Error("Invalid sponsored quantity");
  return n;
}
function same(a:unknown,b:string) {return typeof a==="string"&&/^0x[0-9a-f]{40}$/i.test(a)&&a.toLowerCase()===b.toLowerCase();}
function ceil(a:bigint,b:bigint) {return (a+b-1n)/b;}
/** Supported direct-token mode only, using conservative ceil (including source). */
export function sourceFeeCap(op:FundingOperation):bigint {
  const d=op.paymasterData;
  if(typeof d!=="string"||!/^0x[0-9a-f]{364,8192}$/i.test(d)||d.length%2!==0)throw new Error("Malformed paymaster data");
  const raw=d.slice(2).toLowerCase();
  if(!["02","03"].includes(raw.slice(0,2))||raw.slice(2,4)!=="00"||!same("0x"+raw.slice(28,68),monadUsdc))throw new Error("Unsupported source paymaster configuration");
  uint(op.nonce);uint(op.maxPriorityFeePerGas);
  const fee=uint(op.maxFeePerGas,true);
  if(op.maxPriorityFeePerGas>fee)throw new Error("Invalid sponsored fee prices");
  const gas=uint(gasFields.reduce((sum,key)=>sum+uint(op[key]),0n),true);
  const post=BigInt("0x"+raw.slice(68,100)),rate=uint(BigInt("0x"+raw.slice(100,164)),true);
  return uint(ceil((gas+post)*fee*rate,10n**18n),true);
}
export function validateFundingOperation(op:FundingOperation,calls:readonly FundingCall[],binding:{owner:Address;recipient:Address;amount:bigint;budget:bigint;allowance:bigint}):bigint {
  const {owner,recipient,amount,budget,allowance}=binding;
  uint(amount,true);uint(budget,true);uint(allowance);
  const noFactory=op.factory===undefined&&op.factoryData===undefined;
  const delegationStub=op.factory==="0x7702"&&op.factoryData==="0x";
  if(!same(op.sender,owner)||!same(op.paymaster,tokenPaymaster)||(!noFactory&&!delegationStub)||same(recipient,owner)||same(recipient,"0x0000000000000000000000000000000000000000"))throw new Error("Unexpected source operation identity");
  const cap=sourceFeeCap(op);
  if(amount+cap>budget||calls.length<1||calls.length>2)throw new Error("Source budget or call count changed");
  const transfer=calls[calls.length-1]!;
  const expected=encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[getAddress(recipient),amount]});
  if(!same(transfer.to,monadUsdc)||(transfer.value??0n)!==0n||transfer.data?.toLowerCase()!==expected.toLowerCase())throw new Error("Source USDC transfer changed");
  if(calls.length===2){
    const a=calls[0]!;
    if(!same(a.to,monadUsdc)||(a.value??0n)!==0n||!a.data||a.data.length!==138)throw new Error("Unexpected approval");
    const decoded=decodeFunctionData({abi:erc20Abi,data:a.data});
    if(decoded.functionName!=="approve"||!same(decoded.args[0],tokenPaymaster)||decoded.args[1]<cap||decoded.args[1]>cap+cap/100n+1n)throw new Error("Paymaster approval outside bounded fee");
  } else if(allowance<cap)throw new Error("Paymaster allowance too small");
  return cap;
}

/** The SDK floors token approval. Rebuild our two allowed calls using ceil,
 * then re-estimate the actual encoding and refresh stub pricing before using it. */
export async function stabilizeFundingApproval<T extends FundingOperation>(
  initial:T,
  binding:{owner:Address;recipient:Address;amount:bigint;budget:bigint;allowance:bigint},
  encode:(calls:FundingCall[])=>Promise<Hex>,
  estimate:(operation:T)=>Promise<T>,
):Promise<T> {
  let operation=initial;
  for(let attempt=0;attempt<4;attempt++) {
    const cap=sourceFeeCap(operation);
    if(binding.amount+cap>binding.budget)throw new Error("Source fee consumes approved budget");
    const calls:FundingCall[]=[];
    if(binding.allowance<cap) calls.push({to:monadUsdc,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:"approve",args:[tokenPaymaster,ceil(cap*101n,100n)]})});
    calls.push({to:monadUsdc,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[binding.recipient,binding.amount]})});
    operation=await estimate({...operation,callData:await encode(calls)});
    const checked=sourceFeeCap(operation);
    if(binding.amount+checked>binding.budget)throw new Error("Re-estimated source fee exceeds budget");
    try {
      validateFundingOperation(operation,calls,binding);
      return operation;
    } catch {
      // A changed gas/rate requires another narrowly rebuilt unsigned attempt.
    }
  }
  throw new Error("Conservative source approval did not stabilize");
}

/** Address-only preparation. No wallet keys, signing calls or broadcasts. */
export class MonadFundingPlanner {
  constructor(private key?:string,private rpcUrl="https://rpc.monad.xyz",private now:()=>number=Date.now) {}
  async prepare(input:{owner:Address;recipient:Address;amount:string;budget:string}) {
    if(!this.key)throw new InfrastructureError(503,"EARN_PAYMASTER_UNCONFIGURED","USDC gas sponsorship is not configured.");
    if(![input.amount,input.budget].every(v=>/^[1-9][0-9]{0,77}$/.test(v))||!/^0x[0-9a-f]{40}$/i.test(input.owner)||!/^0x[0-9a-f]{40}$/i.test(input.recipient))throw new InfrastructureError(400,"INVALID_EARN_FUNDING","A source wallet, exact amount and funding budget are required.");
    const amount=uint(BigInt(input.amount),true),budget=uint(BigInt(input.budget),true);
    if(amount>budget||same(input.owner,input.recipient))throw new InfrastructureError(400,"INVALID_EARN_FUNDING","Funding amount is outside the approved source budget.");
    const transport=http(`https://api.pimlico.io/v2/143/rpc?apikey=${encodeURIComponent(this.key)}`,{timeout:12000,retryCount:0});
    const client=createPublicClient({chain:monad,transport:http(this.rpcUrl,{timeout:12000,retryCount:0}),cacheTime:0});
    try {
      if(await client.getChainId()!==143)throw new Error("Source chain changed");
      const owner=getAddress(input.owner),recipient=getAddress(input.recipient);
      const refuse=async():Promise<never>=>{throw new Error("Unsigned preview cannot sign");};
      // This SDK's owner type is unnecessarily restricted to PrivateKeyAccount.
      // The runtime custom account contains no key, and every sign method refuses.
      const previewOwner=toAccount({address:owner,sign:refuse,signAuthorization:refuse,signMessage:refuse,signTypedData:refuse,signTransaction:refuse}) as PrivateKeyAccount;
      const account=await toSimple7702SmartAccount({client,owner:previewOwner});
      const block=await client.getBlock();
      const timestampMs=Number(block.timestamp)*1000;
      if(!Number.isSafeInteger(timestampMs)||this.now()-timestampMs>60000||timestampMs-this.now()>5000)throw new Error("Stale source block");
      const [latest,pending,code,held,decimals,paymasterCode] = await Promise.all([
        client.getTransactionCount({address:owner,blockNumber:block.number}),client.getTransactionCount({address:owner,blockTag:"pending"}),client.getCode({address:owner,blockNumber:block.number}),
        client.readContract({address:monadUsdc,abi:erc20Abi,functionName:"balanceOf",args:[owner],blockNumber:block.number}),
        client.readContract({address:monadUsdc,abi:erc20Abi,functionName:"decimals",blockNumber:block.number}),client.getCode({address:tokenPaymaster,blockNumber:block.number}),
      ]);
      const expected=`0xef0100${account.authorization.address.slice(2)}`.toLowerCase();
      if(latest!==pending||account.address.toLowerCase()!==owner.toLowerCase()||decimals!==6||held<budget||!paymasterCode||paymasterCode==="0x"||(code&&code!=="0x"&&code.toLowerCase()!==expected))throw new Error("Unsupported source state");
      const pimlico=createPimlicoClient({chain:monad,transport,entryPoint:{address:entryPoint08Address,version:"0.8"}});
      const [supported,quotes,fees]=await Promise.all([pimlico.getSupportedEntryPoints(),pimlico.getTokenQuotes({tokens:[monadUsdc],chain:monad}),pimlico.getUserOperationGasPrice()]);
      if(!supported.some(a=>same(a,entryPoint08Address))||quotes.length!==1||!same(quotes[0]?.paymaster,tokenPaymaster)||!same(quotes[0]?.token,monadUsdc))throw new Error("Unsupported source sponsorship");
      const bundler=createSmartAccountClient({account,client,chain:monad,bundlerTransport:transport,paymaster:{getPaymasterStubData:pimlico.getPaymasterStubData,getPaymasterData:pimlico.getPaymasterStubData},userOperation:{estimateFeesPerGas:async()=>fees.standard,prepareUserOperation:prepareUserOperationForErc20Paymaster(pimlico)}});
      const initial=await bundler.prepareUserOperation({account,paymasterContext:{token:monadUsdc},calls:[{to:monadUsdc,data:encodeFunctionData({abi:erc20Abi,functionName:"transfer",args:[recipient,amount]}),value:0n}]});
      if(!account.decodeCalls)throw new Error("Account call decoder unavailable");
      const allowance=await client.readContract({address:monadUsdc,abi:erc20Abi,functionName:"allowance",args:[owner,tokenPaymaster],blockNumber:block.number});
      const op=await stabilizeFundingApproval(initial,{owner,recipient,amount,budget,allowance},async(calls)=>account.encodeCalls(calls),async(operation)=>{
        const gas=await pimlico.estimateUserOperationGas({...operation,account});
        const refreshed=await pimlico.getPaymasterStubData({...operation,...gas,chainId:143,entryPointAddress:entryPoint08Address,context:{token:monadUsdc}});
        if(!refreshed.paymaster||!refreshed.paymasterData||("paymasterAndData" in refreshed&&refreshed.paymasterAndData!==undefined))throw new Error("Unexpected EntryPoint sponsorship format");
        return {...operation,
          callGasLimit:uint(gas.callGasLimit,true),preVerificationGas:uint(gas.preVerificationGas,true),verificationGasLimit:uint(gas.verificationGasLimit,true),
          paymaster:refreshed.paymaster,paymasterData:refreshed.paymasterData,
          paymasterPostOpGasLimit:uint(refreshed.paymasterPostOpGasLimit??gas.paymasterPostOpGasLimit??operation.paymasterPostOpGasLimit),
          paymasterVerificationGasLimit:uint(refreshed.paymasterVerificationGasLimit??gas.paymasterVerificationGasLimit??operation.paymasterVerificationGasLimit),
        };
      });
      const decoded=await account.decodeCalls(op.callData);
      const cap=validateFundingOperation(op,decoded,{owner,recipient,amount,budget,allowance});
      const [canonical,currentLatest,currentPending,currentCode,currentAllowance,currentBalance]=await Promise.all([
        client.getBlock({blockNumber:block.number}),client.getTransactionCount({address:owner,blockTag:"latest"}),client.getTransactionCount({address:owner,blockTag:"pending"}),client.getCode({address:owner}),
        client.readContract({address:monadUsdc,abi:erc20Abi,functionName:"allowance",args:[owner,tokenPaymaster]}),client.readContract({address:monadUsdc,abi:erc20Abi,functionName:"balanceOf",args:[owner]}),
      ]);
      if(canonical.hash!==block.hash||currentLatest!==latest||currentPending!==latest||currentCode!==code||currentAllowance!==allowance||currentBalance!==held||this.now()-timestampMs>60000||op.maxFeePerGas<fees.standard.maxFeePerGas||op.maxPriorityFeePerGas<fees.standard.maxPriorityFeePerGas)throw new Error("Source fee reference changed");
      if(op.authorization&&(op.authorization.chainId!==143||op.authorization.nonce!==latest||!same(op.authorization.address,account.authorization.address)))throw new Error("Source authorization state changed");
      // SDK authorization/signature placeholders are deliberately not signing authority.
      const unsigned=formatUserOperationRequest(op);
      return {version:"gizu-monad-funding-v1" as const,chainId:143 as const,owner,recipient,token:monadUsdc,amount:amount.toString(),budget:budget.toString(),feeCap:cap.toString(),remainingBudget:(budget-amount-cap).toString(),entryPoint:entryPoint08Address,paymaster:tokenPaymaster,delegation:account.authorization.address,authorizationRequired:!code||code==="0x",authorizationNonce:latest.toString(),referenceBlock:block.number.toString(),referenceHash:block.hash,timestampMs,expiresAtMs:timestampMs+60000,operation:unsigned,paymasterDataStatus:"stub" as const,executionAvailable:false as const};
    } catch(error) {
      if(error instanceof InfrastructureError)throw error;
      throw new InfrastructureError(502,"EARN_FUNDING_UNAVAILABLE","Could not verify source USDC sponsorship, fee bounds and exact transfer. No operation was signed or sent.");
    }
  }
}
