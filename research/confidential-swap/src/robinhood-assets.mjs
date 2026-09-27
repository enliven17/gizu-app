import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {erc20Abi, getAddress, parseUnits} from 'viem';
import {passesLiquidityRule, priceImpactBps} from './core.mjs';
import {oneInch, robinhoodChainId} from './robinhood-swap.mjs';

export const directSymbols=['ETH','WETH','USDe','USDG'];
export const usdgContract=getAddress(process.env.ROBINHOOD_USDG_CONTRACT?.trim()||'0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168');
const probeAtoms=10_000_000n;

export function liquidityConfig() {
  const reference=parseUnits(process.env.LIQUIDITY_REFERENCE_USDG?.trim()||'1000',6);
  const maxImpactBps=Number(process.env.MAX_PRICE_IMPACT_BPS?.trim()||'100');
  if(reference<=probeAtoms||!Number.isInteger(maxImpactBps)||maxImpactBps<0) throw new Error('Invalid LIQUIDITY_REFERENCE_USDG or MAX_PRICE_IMPACT_BPS');
  return {reference,maxImpactBps};
}

export function directTargets(tokens) {
  return directSymbols.map(symbol=>{
    const matches=tokens.filter(t=>t.blockchain==='hood'&&t.symbol===symbol);
    if(matches.length!==1) return null;
    const t=matches[0];
    return {symbol,routeType:'direct',assetId:t.assetId,decimals:t.decimals,contract:t.contractAddress?getAddress(t.contractAddress):null};
  }).filter(Boolean);
}

export async function stockCandidates() {
  const response=await fetch('https://api.robinhood.com/rhj/assets',{signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Robinhood assets API failed: ${response.status}`);
  const {assets}=await response.json();
  if(!Array.isArray(assets)) throw new Error('Robinhood assets API returned no asset list');
  return assets.filter(a=>a.status==='ASSET_STATUS_ACTIVE').flatMap(a=>{
    const deployment=a.deployments?.find(d=>d.chainId===robinhoodChainId);
    return deployment?[{symbol:a.tokenSymbol,name:a.tokenName,contract:getAddress(deployment.contractAddress),decimals:a.tokenDecimals,tradingCapabilities:a.tradingCapabilities}]:[];
  });
}

const pause=()=>new Promise(resolve=>setTimeout(resolve,Number(process.env.ONEINCH_DELAY_MS?.trim()||'1100')));

export async function checkLiquidity(contract,{reference,maxImpactBps}) {
  const probe=await oneInch('quote',{src:usdgContract,dst:contract,amount:probeAtoms});
  await pause();
  const large=await oneInch('quote',{src:usdgContract,dst:contract,amount:reference});
  await pause();
  const probeQuote={amountIn:probeAtoms,amountOut:BigInt(probe.dstAmount)};
  const referenceQuote={amountIn:reference,amountOut:BigInt(large.dstAmount)};
  return {impactBps:priceImpactBps(probeQuote,referenceQuote),passes:passesLiquidityRule(probeQuote,referenceQuote,maxImpactBps)};
}

export async function buildTargetSet({tokens,client}) {
  const config=liquidityConfig();
  const direct=directTargets(tokens);
  const stocks=[];
  const skipped=[];
  for(const stock of await stockCandidates()) {
    const [symbol,decimals]=await Promise.all([client.readContract({address:stock.contract,abi:erc20Abi,functionName:'symbol'}),client.readContract({address:stock.contract,abi:erc20Abi,functionName:'decimals'})]);
    if(symbol!==stock.symbol||decimals!==stock.decimals) { skipped.push({symbol:stock.symbol,reason:'onchain metadata mismatch'}); continue; }
    try {
      const liquidity=await checkLiquidity(stock.contract,config);
      if(!liquidity.passes) { skipped.push({symbol:stock.symbol,reason:`price impact ${liquidity.impactBps} bps`}); continue; }
      stocks.push({symbol:stock.symbol,name:stock.name,routeType:'usdg_then_swap',contract:stock.contract,decimals,impactBps:liquidity.impactBps.toString(),tradingCapabilities:stock.tradingCapabilities});
    } catch(error) { skipped.push({symbol:stock.symbol,reason:error.message}); }
  }
  return {checkedAt:new Date().toISOString(),chainId:robinhoodChainId,usdg:usdgContract,referenceUSDG:config.reference.toString(),maxImpactBps:config.maxImpactBps,direct,stocks,skipped};
}

export async function loadTarget(file,symbol) {
  if(!existsSync(file)) throw new Error('Run assets first to pin the Robinhood target set');
  const set=JSON.parse(await readFile(file,'utf8'));
  const matches=[...set.direct,...set.stocks].filter(t=>t.symbol===symbol);
  if(matches.length!==1) throw new Error(`TARGET ${symbol} is not in the pinned Robinhood target set`);
  return matches[0];
}
