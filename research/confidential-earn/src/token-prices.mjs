// Provider/CDN token listings can outlive the five-minute valuation policy.
// Bypass the cached response; still reject stale prices from the origin.
export async function readTokenPrices({apiKey,assetIds,fetcher=fetch,now=Date.now()}){
 const url=new URL(`https://intents-api.aurora.dev/api/tokens/${encodeURIComponent(apiKey)}`);
 url.searchParams.set('valuationAt',String(now));
 const response=await fetcher(url,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Aurora price registry unavailable');
 const tokens=(await response.json()).tokens;
 if(!Array.isArray(tokens))throw new Error('Missing token valuation registry');
 return assetIds.map(id=>{
  const token=tokens.find(t=>t.assetId===id),time=Date.parse(token?.priceUpdatedAt);
  if(!token||!Number.isFinite(token.price)||token.price<=0||!Number.isFinite(time)||now-time>300000||time>now+60000)throw new Error('Stale/missing/invalid token valuation');
  return BigInt(Math.ceil(token.price*1e6));
 });
}
