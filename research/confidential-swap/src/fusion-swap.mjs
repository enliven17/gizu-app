import {FusionSDK, NetworkEnum, RelayerRequest} from '@1inch/fusion-sdk';
import {getLimitOrderContract} from '@1inch/limit-order-sdk';
import {domainSeparator, encodeAbiParameters, encodeFunctionData, getAddress, parseAbi, parseSignature} from 'viem';
import {robinhoodChainId} from './robinhood-swap.mjs';

export const fusionSpender=getAddress(getLimitOrderContract(robinhoodChainId));
const permitAbi=parseAbi([
  'function name() view returns (string)',
  'function nonces(address) view returns (uint256)',
  'function DOMAIN_SEPARATOR() view returns (bytes32)',
  'function permit(address owner,address spender,uint256 value,uint256 deadline,uint8 v,bytes32 r,bytes32 s)',
]);
const permitTypes={Permit:[{name:'owner',type:'address'},{name:'spender',type:'address'},{name:'value',type:'uint256'},{name:'nonce',type:'uint256'},{name:'deadline',type:'uint256'}]};

function fusionApiUrl() { return process.env.FUSION_API_URL?.trim()||'https://api.1inch.com/fusion'; }
function authKey() {
  const key=process.env.ONEINCH_API_KEY?.trim();
  if(!key) throw new Error('Missing ONEINCH_API_KEY in .env');
  return key;
}

// viem needs bigint for uint fields and rejects EIP712Domain inside types.
function viemTypedData(typedData) {
  const {EIP712Domain,...types}=typedData.types;
  const fields=types[typedData.primaryType];
  const message=Object.fromEntries(Object.entries(typedData.message).map(([name,value])=>{
    const type=fields.find(field=>field.name===name)?.type??'';
    return [name,type.startsWith('uint')||type.startsWith('int')?BigInt(value):value];
  }));
  return {domain:typedData.domain,types,primaryType:typedData.primaryType,message};
}

export function viemConnector({owner,client}) {
  return {
    async signTypedData(walletAddress,typedData) {
      if(getAddress(walletAddress)!==owner.address) throw new Error('Fusion asked to sign for another wallet');
      return owner.signTypedData(viemTypedData(typedData));
    },
    async ethCall(contractAddress,callData) {
      const result=await client.call({to:getAddress(contractAddress),data:callData});
      return result.data??'0x';
    },
  };
}

export async function createFusion({owner,client}) {
  if((await client.getChainId())!==robinhoodChainId) throw new Error('Expected Robinhood Chain mainnet');
  const code=await client.getCode({address:fusionSpender});
  if(!code||code==='0x') throw new Error('1inch Limit Order Protocol is not deployed on Robinhood');
  const sdk=new FusionSDK({url:fusionApiUrl(),network:NetworkEnum.ROBINHOOD,blockchainProvider:viemConnector({owner,client}),authKey:authKey()});
  return {sdk,client,owner,spender:fusionSpender};
}

async function permitDomain(client,token) {
  const [name,separator]=await Promise.all([
    client.readContract({address:token,abi:permitAbi,functionName:'name'}),
    client.readContract({address:token,abi:permitAbi,functionName:'DOMAIN_SEPARATOR'}),
  ]);
  for(const version of ['1','2']) {
    const domain={name,version,chainId:robinhoodChainId,verifyingContract:token};
    if(domainSeparator({domain}).toLowerCase()===separator.toLowerCase()) return domain;
  }
  throw new Error(`Cannot reproduce ${name} DOMAIN_SEPARATOR; no permit was signed`);
}

// LOP v4 forwards a 7-word maker permit to IERC20Permit.permit, so the payload is the ABI-encoded arguments without the selector.
export async function buildPermit({client,owner,token,spender,amount,deadline}) {
  token=getAddress(token);
  const [domain,nonce]=await Promise.all([permitDomain(client,token),client.readContract({address:token,abi:permitAbi,functionName:'nonces',args:[owner.address]})]);
  const message={owner:owner.address,spender:getAddress(spender),value:amount,nonce,deadline};
  const {r,s,yParity}=parseSignature(await owner.signTypedData({domain,types:permitTypes,primaryType:'Permit',message}));
  const v=27+yParity;
  await client.call({account:spender,to:token,data:encodeFunctionData({abi:permitAbi,functionName:'permit',args:[owner.address,message.spender,amount,deadline,v,r,s]})});
  const data=encodeAbiParameters([{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'},{type:'uint8'},{type:'bytes32'},{type:'bytes32'}],[owner.address,message.spender,amount,deadline,v,r,s]);
  return {data,nonce,deadline,amount,spender:message.spender};
}

// Axios errors carry request headers; only the HTTP status and the relayer's short reason are surfaced.
async function fusionCall(what,call) {
  try { return await call(); }
  catch(error) {
    const status=error.response?.status;
    if(!status) throw new Error(`1inch Fusion ${what} failed: ${error.message}`);
    const body=error.response.data;
    const reason=typeof body==='string'?body:body?.description??body?.message??body?.error??'';
    const wrapped=new Error(`1inch Fusion ${what} failed: ${status} ${String(reason).slice(0,200)}`.trim());
    wrapped.status=status;
    throw wrapped;
  }
}

function presetSummary(quote,preset) {
  const selected=quote.getPreset(preset);
  return {preset,auctionStartAmount:selected.auctionStartAmount,auctionEndAmount:selected.auctionEndAmount,auctionDuration:selected.auctionDuration,allowPartialFills:selected.allowPartialFills,allowMultipleFills:selected.allowMultipleFills};
}

export async function fusionQuote(context,{srcToken,dstToken,amount,preset}) {
  const quote=await fusionCall('quote',()=>context.sdk.getQuote({fromTokenAddress:getAddress(srcToken),toTokenAddress:getAddress(dstToken),amount:amount.toString(),walletAddress:context.owner.address}));
  return {marketOut:BigInt(quote.toTokenAmount),recommendedPreset:quote.recommendedPreset,settlement:quote.settlementAddress.toString(),...presetSummary(quote,preset)};
}

export function fusionOrderSummary(order,permit) {
  const extension=order.extension;
  return {
    maker:order.maker.toString(),receiver:order.realReceiver.toString(),
    makerAsset:order.makerAsset.toString(),takerAsset:order.takerAsset.toString(),
    makingAmount:order.makingAmount,takingAmount:order.takingAmount,deadline:order.deadline,
    makerPermit:extension.makerPermit,expectedPermit:permit?`${order.makerAsset.toString().toLowerCase()}${permit.slice(2).toLowerCase()}`:'0x',
  };
}

export async function fusionCreate(context,{srcToken,dstToken,amount,permit,preset}) {
  const {order,hash,quoteId}=await fusionCall('order quote',()=>context.sdk.createOrder({fromTokenAddress:getAddress(srcToken),toTokenAddress:getAddress(dstToken),amount:amount.toString(),walletAddress:context.owner.address,permit,preset}));
  return {order,hash,quoteId};
}

export async function fusionSign(context,{order,hash,quoteId}) {
  const signature=await context.sdk.signOrder(order);
  return {orderHash:hash,quoteId,signature,order:order.build(),extension:order.extension.encode()};
}

export async function fusionSubmit(context,signed) {
  await fusionCall('submit',()=>context.sdk.api.submitOrder(RelayerRequest.new({order:signed.order,signature:signed.signature,quoteId:signed.quoteId,extension:signed.extension})));
}

export async function fusionStatus(context,orderHash) {
  return fusionCall('status',()=>context.sdk.getOrderStatus(orderHash));
}
