import {getAddress} from 'viem';
import {assertQuote,quoteDeadline} from './core.mjs';
// Generates a quote only. Funding is a separate Ethereum transaction.
export async function quoteAuroraReturn({apiKey,owner,confidential,originAsset,destinationAsset,amount,quotedResponse}) {
 if(!apiKey||amount<=0n)throw new Error('Aurora return quote requires a key and positive amount');
 const request={dry:false,swapType:'EXACT_INPUT',depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:confidential.toLowerCase(),refundType:'ORIGIN_CHAIN',refundTo:getAddress(owner),originAsset,destinationAsset,amount:String(amount),slippageTolerance:100,confidentiality:'advanced'};
 let result=quotedResponse;
 if(!result){
  const response=await fetch(`https://intents-api.aurora.dev/api/quote/${encodeURIComponent(apiKey)}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error(`Aurora return quote HTTP ${response.status}`);
  result=await response.json();
 }
 const quote=assertQuote(request,result);
 if(BigInt(quote.amountIn)!==amount||quote.depositMemo)throw new Error('Unsupported Aurora return amount or memo');
 return {request,result,recipient:getAddress(quote.depositAddress),deadline:BigInt(Math.floor(quoteDeadline(result)/1000)),minimumOut:BigInt(quote.minAmountOut)};
}
