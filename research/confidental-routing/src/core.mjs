import {randomBytes} from 'node:crypto';
import {base58} from '@scure/base';
import {hexToBytes} from 'viem';

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
