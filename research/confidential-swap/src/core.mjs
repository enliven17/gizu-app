import {randomBytes} from 'node:crypto';
import {base58} from '@scure/base';
import {decodeFunctionData, getAddress, hexToBytes, parseAbi} from 'viem';

export const oneInchRouterAbi = parseAbi([
  'function swap(address executor,(address srcToken,address dstToken,address srcReceiver,address dstReceiver,uint256 amount,uint256 minReturnAmount,uint256 flags) desc,bytes data) payable returns (uint256,uint256)',
  'function unoswap(uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)',
  'function unoswap2(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2) returns (uint256)',
  'function unoswap3(uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) returns (uint256)',
  'function unoswapTo(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex) returns (uint256)',
  'function unoswapTo2(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2) returns (uint256)',
  'function unoswapTo3(uint256 to,uint256 token,uint256 amount,uint256 minReturn,uint256 dex,uint256 dex2,uint256 dex3) returns (uint256)',
]);
const addressMask = (1n << 160n) - 1n;
const packedAddress = value => getAddress(`0x${(value & addressMask).toString(16).padStart(40, '0')}`);

export function splitSourceBudget(total) {
  if (typeof total !== 'bigint' || total <= 0n) throw new Error('Source budget must be positive integer atoms');
  const first = total * 3n / 10n;
  return [first, first, total - first * 2n];
}

export function encodeAuroraSignature(signature) {
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) throw new Error('Expected a 65-byte ERC-191 signature');
  const bytes = hexToBytes(signature);
  if (bytes[64] === 27 || bytes[64] === 28) bytes[64] -= 27;
  if (bytes[64] !== 0 && bytes[64] !== 1) throw new Error('Invalid signature recovery bit');
  return `secp256k1:${base58.encode(bytes)}`;
}

export function validatePreparedIntent(intent, approved) {
  if (intent?.standard !== 'erc191' || typeof intent.payload !== 'string') throw new Error('Expected an ERC-191 intent payload');
  let message;
  try { message = JSON.parse(intent.payload); } catch { throw new Error('Intent payload is not JSON'); }
  if (message.signer_id?.toLowerCase() !== approved.signerId.toLowerCase()) throw new Error('Intent signer differs from C');
  if (message.verifying_contract !== approved.verifyingContract) throw new Error('Wrong verifying contract');
  if (typeof message.nonce !== 'string' || Buffer.from(message.nonce, 'base64').length !== 32) throw new Error('Invalid intent nonce');
  if (!Number.isFinite(Date.parse(message.deadline)) || Date.parse(message.deadline) <= approved.now.getTime()) throw new Error('Intent expired');
  if (!Array.isArray(message.intents) || message.intents.length !== 1) throw new Error('Expected exactly one transfer intent');
  const transfer = message.intents[0];
  if (transfer.intent !== 'transfer' || transfer.receiver_id !== approved.depositAddress) throw new Error('Intent receiver differs from quote');
  if (Object.keys(transfer.tokens ?? {}).length !== 1 || transfer.tokens[approved.tokenId] !== approved.amount.toString()) throw new Error('Intent token/amount differs from quote');
  return message;
}

export function assertQuote(request, response) {
  const returned = response?.quoteRequest;
  const quote = response?.quote;
  if (!returned || !quote || !quote.depositAddress || !response.signature) throw new Error('Incomplete quote');
  for (const field of ['swapType','depositType','recipientType','recipient','refundType','refundTo','originAsset','destinationAsset','confidentiality','amount']) {
    if (String(returned[field]).toLowerCase() !== String(request[field]).toLowerCase()) throw new Error(`Quote changed ${field}`);
  }
  if (request.confidentiality !== 'basic' && request.confidentiality !== 'advanced') throw new Error('Public quote rejected');
  if (Date.parse(quote.deadline) <= Date.now()) throw new Error('Quote deadline passed');
  return quote;
}

export function chooseConfidentialAsset(all, source, override) {
  if (!override) return source;
  const token=all.find(t=>t.assetId===override);
  if (!token || token.symbol?.toUpperCase()!=='USDC' || token.decimals!==6) throw new Error('PRIVATE_ASSET_ID must identify a six-decimal USDC token in Aurora registry');
  return token;
}

export function buildAuthPayload(accountAddress, saltHex, startedAt=new Date(), randomPart=randomBytes(7)) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(accountAddress)) throw new Error('Invalid confidential account address');
  if (!/^[0-9a-fA-F]{8}$/.test(saltHex)) throw new Error('Invalid public Intents salt');
  if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) throw new Error('Invalid authentication time');
  if (randomPart.length!==7) throw new Error('Authentication nonce needs seven random bytes');
  const deadline=new Date(startedAt.getTime()+5*60_000);
  const nonce=Buffer.alloc(32);
  Buffer.from('5628f6c600','hex').copy(nonce,0);
  Buffer.from(saltHex,'hex').copy(nonce,5);
  nonce.writeBigUInt64LE(BigInt(deadline.getTime())*1_000_000n,9);
  nonce.writeBigUInt64LE(BigInt(startedAt.getTime())*1_000_000n,17);
  Buffer.from(randomPart).copy(nonce,25);
  return JSON.stringify({signer_id:accountAddress.toLowerCase(),verifying_contract:'intents.near',deadline:deadline.toISOString(),nonce:nonce.toString('base64'),intents:[]});
}

export function selectPrivateBalance(balances, assetId) {
  const matches=balances.filter(b=>b.source==='private' && b.tokenId===assetId);
  if(matches.length!==1) throw new Error('Confidential balance token is missing or ambiguous');
  return matches[0];
}

export function swapAmount(balance, feeCap) {
  if(typeof balance!=='bigint'||typeof feeCap!=='bigint'||balance<=0n||feeCap<0n||feeCap>=balance) throw new Error('USDG paymaster fee consumes the swap balance');
  return balance-feeCap;
}

export function minimumOut(quotedOut, slippageBps) {
  if(typeof quotedOut!=='bigint'||quotedOut<=0n||!Number.isInteger(slippageBps)||slippageBps<0||slippageBps>=10_000) throw new Error('Invalid swap minimum');
  return quotedOut*BigInt(10_000-slippageBps)/10_000n;
}

// Impact of the reference size relative to a small probe of the same pair, in basis points.
export function priceImpactBps(probe, reference) {
  for (const q of [probe,reference]) if(typeof q?.amountIn!=='bigint'||typeof q?.amountOut!=='bigint'||q.amountIn<=0n||q.amountOut<=0n) throw new Error('Liquidity quotes need positive integer amounts');
  const probeValue=probe.amountOut*reference.amountIn;
  const referenceValue=reference.amountOut*probe.amountIn;
  if(referenceValue>=probeValue) return 0n;
  return (probeValue-referenceValue)*10_000n/probeValue;
}

export function passesLiquidityRule(probe, reference, maxImpactBps) {
  if(!Number.isInteger(maxImpactBps)||maxImpactBps<0) throw new Error('Invalid price impact threshold');
  return priceImpactBps(probe,reference)<=BigInt(maxImpactBps);
}

export function validateFusionOrder(order, approved) {
  const same=(a,b)=>getAddress(a)===getAddress(b);
  const wallet=getAddress(approved.maker);
  if(!same(order.maker,wallet)) throw new Error('Fusion order maker differs from the destination wallet');
  if(!same(order.receiver,approved.receiver??wallet)) throw new Error('Fusion order receiver differs from the destination wallet');
  if(!same(order.makerAsset,approved.srcToken)||!same(order.takerAsset,approved.dstToken)) throw new Error('Fusion order tokens differ from the approved pair');
  if(order.makingAmount!==approved.amount) throw new Error('Fusion order making amount differs from the approved input');
  if(typeof approved.minOut!=='bigint'||approved.minOut<=0n||order.takingAmount<approved.minOut) throw new Error('Fusion auction end amount is below the approved minimum');
  if(approved.permit&&order.makerPermit.toLowerCase()!==`${getAddress(approved.srcToken).toLowerCase()}${approved.permit.slice(2).toLowerCase()}`) throw new Error('Fusion order carries a different maker permit');
  if(order.deadline<=BigInt(Math.floor((approved.now??Date.now())/1000))) throw new Error('Fusion order is already expired');
  return {minOut:order.takingAmount,deadline:order.deadline};
}

export function validateRouterQuote(response, approved) {
  const tx=response?.tx;
  if(!tx||typeof tx.data!=='string'||typeof response.dstAmount!=='string') throw new Error('Incomplete router swap response');
  if(getAddress(tx.to)!==getAddress(approved.router)) throw new Error('Swap calldata targets an unapproved router');
  if(BigInt(tx.value??0)!==0n) throw new Error('Swap must not send native value');
  if(tx.from&&getAddress(tx.from)!==getAddress(approved.receiver)) throw new Error('Swap sender differs from the destination wallet');
  const quotedOut=BigInt(response.dstAmount);
  const minOut=minimumOut(quotedOut,approved.slippageBps);
  validateRouterCall(tx.data,{...approved,minOut});
  return {to:getAddress(tx.to),data:tx.data,quotedOut,minOut};
}

export function validateRouterCall(data, approved) {
  let call;
  try { call=decodeFunctionData({abi:oneInchRouterAbi,data}); } catch { throw new Error('Unsupported router function'); }
  const src=getAddress(approved.srcToken), receiver=getAddress(approved.receiver);
  if(call.functionName==='swap') {
    const desc=call.args[1];
    if(getAddress(desc.srcToken)!==src||getAddress(desc.dstToken)!==getAddress(approved.dstToken)) throw new Error('Router swap tokens differ from the approved pair');
    if(getAddress(desc.dstReceiver)!==receiver) throw new Error('Router swap receiver differs from the destination wallet');
    if(desc.amount!==approved.amountIn) throw new Error('Router swap amount differs from the approved input');
    if(desc.minReturnAmount<approved.minOut) throw new Error('Router minimum return is below the approved minimum');
    return {functionName:call.functionName,minReturn:desc.minReturnAmount};
  }
  const hasTo=call.functionName.startsWith('unoswapTo');
  const [to,token,amount,minReturn]=hasTo?call.args:[undefined,...call.args];
  if(hasTo&&packedAddress(to)!==receiver) throw new Error('Router swap receiver differs from the destination wallet');
  if(packedAddress(token)!==src) throw new Error('Router swap tokens differ from the approved pair');
  if(amount!==approved.amountIn) throw new Error('Router swap amount differs from the approved input');
  if(minReturn<approved.minOut) throw new Error('Router minimum return is below the approved minimum');
  return {functionName:call.functionName,minReturn};
}
