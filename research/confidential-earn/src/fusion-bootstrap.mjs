import {randomBytes} from 'node:crypto';
import {Address,LimitOrderContract,TakerTraits,AmountMode,getLimitOrderContract,Quote,QuoterRequest} from '@1inch/fusion-sdk';
import {domainSeparator,encodeAbiParameters,getAddress,parseAbi,parseSignature,parseUnits} from 'viem';
import {usdc} from './native-vault.mjs';
import {ceilDiv} from './native-gas.mjs';

export const fusionSpender=getAddress(getLimitOrderContract(1));
export const weth=getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2');
export const nativeToken='0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const permitAbi=parseAbi(['function name() view returns(string)','function version() view returns(string)','function nonces(address) view returns(uint256)','function DOMAIN_SEPARATOR() view returns(bytes32)']);
const types={Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};
export function typedDataForViem(typed) {
 const {EIP712Domain:_domain,...types}=typed.types;
 const message=Object.fromEntries(Object.entries(typed.message).map(([key,value])=>[key,types[typed.primaryType].find(f=>f.name===key)?.type.startsWith('uint')?BigInt(value):value]));
 return {...typed,types,message};
}
export async function usdcPermit({client,owner,amount,deadline}) {
 if(amount<=0n)throw new Error('Invalid Fusion input');
 const [name,version,nonce,separator]=await Promise.all(['name','version','nonces','DOMAIN_SEPARATOR'].map(functionName=>client.readContract({address:usdc,abi:permitAbi,functionName,...(functionName==='nonces'?{args:[owner.address]}:{})})));
 const domain={name,version,chainId:1,verifyingContract:usdc};
 if(domainSeparator({domain}).toLowerCase()!==separator.toLowerCase())throw new Error('USDC permit domain mismatch');
 const {r,s,yParity}=parseSignature(await owner.signTypedData({domain,types,primaryType:'Permit',message:{owner:owner.address,spender:fusionSpender,value:amount,nonce,deadline}}));
 return encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'uint8'},{type:'bytes32'},{type:'bytes32'}],[owner.address,fusionSpender,amount,deadline,27+yParity,r,s]);
}
export async function localFillData({order,owner,resolver}) {
 const signature=await owner.signTypedData(typedDataForViem(order.getTypedData(1)));
 const gross=order.calcTakingAmount(new Address(resolver),order.makingAmount,order.auctionEndTime,0n);
 const taker=TakerTraits.default().setAmountMode(AmountMode.maker).setExtension(order.extension).setAmountThreshold(gross);
 return LimitOrderContract.getFillOrderArgsCalldata(order.build(),signature,taker,order.makingAmount);
}

export function orderFromQuote({params,response,permit,preset:selection='fast',nonce=BigInt('0x'+randomBytes(5).toString('hex')),nowMs=Date.now()}) {
 const generated=Number(response.quoteGeneratedAt);
 if(!Number.isFinite(generated)||nowMs-generated>60000||generated-nowMs>5000)throw new Error('Fusion quote is stale or has an invalid timestamp');
 if(Number(response.integratorFee??0)!==0)throw new Error('Fusion application fee is forbidden');
 const quote=new Quote(QuoterRequest.new({...params,permit}),response);
 const preset=quote.getPreset(selection);
 if(preset.allowPartialFills||preset.allowMultipleFills)throw new Error('Full-fill-only Fusion preset required');
 const order=quote.createFusionOrder({network:1,preset:selection,receiver:new Address(params.walletAddress),nonce});
 if(order.makingAmount!==BigInt(params.amount)||order.maker.toString().toLowerCase()!==params.walletAddress.toLowerCase()||order.realReceiver.toString().toLowerCase()!==params.walletAddress.toLowerCase())throw new Error('Fusion order identity/input mismatch');
 if(order.makerAsset.toString().toLowerCase()!==usdc.toLowerCase()||order.takerAsset.toString().toLowerCase()!==weth.toLowerCase()||params.toTokenAddress.toLowerCase()!==nativeToken)throw new Error('Expected USDC to native ETH');
 // At auction end all price bumps are zero. Include protocol/resolver fees.
 const minima=quote.whitelist.map(resolver=>order.getUserReceiveAmount(resolver,order.makingAmount,order.auctionEndTime,0n));
 if(!minima.length)throw new Error('Fusion quote contains no resolvers');
 const gross=quote.whitelist.map(resolver=>order.calcTakingAmount(resolver,order.makingAmount,order.auctionEndTime,0n));
 return {order,minimumEth:minima.reduce((a,b)=>a<b?a:b),grossEth:gross.reduce((a,b)=>a>b?a:b),resolver:quote.whitelist[0].toString()};
}
// Provider estimates include routing; the exact signed replay measured 202,859
// gas for settlement alone (fixtures/native-fusion-signed-replay.json).
export function resolverBudget({response,input,gasPrice,minimumResolverGas=202859n}) {
 const estimates=[response.gas,response.gasLimit].filter(v=>v!==undefined).map(v=>BigInt(v));
 if(!estimates.length||estimates.some(v=>v<=0n))throw new Error('Missing positive Fusion gas estimate');
 if(typeof gasPrice!=='bigint'||gasPrice<=0n||input<=0n)throw new Error('Invalid resolver gas price or input');
 const price=value=>{if(!/^\d+(\.\d+)?$/.test(String(value)))throw new Error('Missing Fusion token prices');const n=parseUnits(String(value),18);if(n<=0n)throw new Error('Invalid Fusion token price');return n;};
 const inputValueWei=input*price(response.prices?.usd?.fromToken)*10n**12n/price(response.prices?.usd?.toToken);
 const estimatedGas=estimates.reduce((a,b)=>a>b?a:b,minimumResolverGas>202859n?minimumResolverGas:202859n);
 const gasUnits=ceilDiv(estimatedGas*120n,100n),budgetGasPrice=ceilDiv(gasPrice*125n,100n);
 const gasCostWei=gasUnits*budgetGasPrice,profitWei=ceilDiv(gasCostWei,10n);
 const allowanceWei=gasCostWei+profitWei;
 return {estimatedGas,gasUnits,gasPrice:budgetGasPrice,gasCostWei,profitWei,allowanceWei,inputValueWei,maximumGrossEth:inputValueWei-allowanceWei};
}
// Provider quote only. Production submission requires enableEstimate and a quoteId.
export async function quoteNativeEth({owner,input,apiKey,permit,enableEstimate=false,resolverGasPrice,minimumResolverGas,fetcher=fetch}) {
 if(!apiKey)throw new Error('ONEINCH_API_KEY is required for live quotes');
 const params={fromTokenAddress:usdc,toTokenAddress:nativeToken,amount:String(input),walletAddress:getAddress(owner),enableEstimate,...(permit?{permit}:{})};
 const query=new URLSearchParams({...params,enableEstimate:String(enableEstimate),surplus:'true'});
 const receive=async body=>{
 const result=await fetcher(`https://api.1inch.com/fusion/quoter/v2.0/1/quote/receive/?${query}`,{headers:{Authorization:`Bearer ${apiKey}`,'content-type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
 const response=await result.json();
 if(!result.ok) {
  const reason=String(response.description??response.error??'unavailable').slice(0,160);
  const error=new Error(`Fusion quote HTTP ${result.status}: ${reason}`);
  if(result.status===400&&reason.toLowerCase()==='insufficient amount')error.code='FUSION_AMOUNT_TOO_SMALL';
  throw error;
 }
 return response;
 };
 let response=await receive();
 if(resolverGasPrice!==undefined){
  const budget=resolverBudget({response,input,gasPrice:resolverGasPrice,minimumResolverGas});
  const bps=BigInt(response.fee?.bps??0);
  if(bps<0n||bps>10000n)throw new Error('Invalid Fusion protocol fee');
  // Include provider fees and 0.5% price headroom between the two requests.
  // Two wei cover integer rounding. Re-check prices from the final response.
  const end=budget.maximumGrossEth*9950n/(10000n+bps)-2n;
  if(end<=0n)throw Object.assign(new Error('Fusion input cannot cover resolver execution'),{code:'FUSION_AMOUNT_TOO_SMALL'});
  const customPreset={auctionDuration:180,auctionStartAmount:String(end),auctionEndAmount:String(end),points:[],allowPartialFills:false,allowMultipleFills:false};
  response=await receive(customPreset);
  const p=response.presets?.custom;
  if(!p||BigInt(p.auctionEndAmount)!==end||BigInt(p.auctionStartAmount)!==end||BigInt(p.initialRateBump)!==0n||p.points?.length)throw new Error('Custom auction amounts or price curve changed');
  const summary=orderFromQuote({params,response,permit,preset:'custom'});
  const checked=resolverBudget({response,input,gasPrice:resolverGasPrice,minimumResolverGas});
  const profitAtBudgetWei=checked.inputValueWei-summary.grossEth-checked.gasCostWei;
  if(profitAtBudgetWei<checked.profitWei)throw new Error('Fusion resolver budget changed during quoting; re-plan');
  return {input,minimumEth:summary.minimumEth,params,response,preset:'custom',economics:{...checked,grossEth:summary.grossEth,profitAtBudgetWei,breakEvenGasPrice:(checked.inputValueWei-summary.grossEth)/checked.gasUnits},timestamp:new Date().toISOString()};
 }
 const summary=orderFromQuote({params,response});
 return {input,minimumEth:summary.minimumEth,params,response,timestamp:new Date().toISOString()};
}
