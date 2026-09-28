import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {privateKeyToAccount, generatePrivateKey} from 'viem/accounts';
import {createPublicClient, defineChain, erc20Abi, formatUnits, getAddress, http, parseAbiItem, parseEventLogs} from 'viem';
import {assertQuote, buildAuthPayload, encodeAuroraSignature, minimumOut, selectPrivateBalance, splitSourceBudget, chooseConfidentialAsset, validateFusionOrder, validatePreparedIntent} from './core.mjs';
import {createMonadPaymaster, fundingAmount, monadFundingReceipt, prepareMonadFunding, signMonadFunding, sourceBudget, submitMonadFunding} from './source-paymaster.mjs';
import {circlePaymaster, circleTransferReceipt, createCircleContext, prepareCircleTransfer, signCircleTransfer, submitCircleTransfer} from './circle-transfer.mjs';
import {createRobinhoodPaymaster, prepareSwapForBalance, robinhood, robinhoodChainId, signSwap, submitSwap, swapReceipt} from './robinhood-swap.mjs';
import {buildTargetSet, checkLiquidity, liquidityConfig, loadTarget, usdgContract} from './robinhood-assets.mjs';
import {buildPermit, createFusion, fusionCreate, fusionOrderSummary, fusionQuote, fusionSign, fusionStatus, fusionSubmit} from './fusion-swap.mjs';

const root = process.cwd();
const secretDir = join(root, '.local');
const secretFile = join(secretDir, 'confidential-key');
const stateFile = join(secretDir, 'state.json');
const targetSetFile = join(secretDir, 'robinhood-assets.json');
const recoverFile = join(secretDir, 'recover.json');
const destinationChain = process.env.DESTINATION?.trim() || 'robinhood';
const swapSlippageBps = Number(process.env.SWAP_SLIPPAGE_BPS?.trim() || '100');
const fusionTarget = process.env.FUSION_TARGET?.trim() || 'AMZN';
const fusionPreset = process.env.FUSION_PRESET?.trim() || 'fast';
const fusionSlippageBps = Number(process.env.FUSION_SLIPPAGE_BPS?.trim() || '100');
const fusionPreviewMaxAgeMs = 10*60_000;
const fusionPermitLifetime = 3600n;
const fusionRetryable = ['expired','cancelled','not_accepted'];
const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
const usdcAtoms = 10_000_000n;
const ethereumUsdc=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const confidentialContract='intents.far';
const monad = defineChain({id:143,name:'Monad Mainnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}}});
const ethereum = defineChain({id:1,name:'Ethereum Mainnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://ethereum-rpc.publicnode.com']}}});
const sourceRpc = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const ethRpc = process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const monadClient = createPublicClient({chain:monad,transport:http(sourceRpc)});
const ethClient = createPublicClient({chain:ethereum,transport:http(ethRpc)});
const hoodClient = createPublicClient({chain:robinhood,transport:http(process.env.ROBINHOOD_RPC_URL || 'https://rpc.mainnet.chain.robinhood.com')});
const destinationClient = chain => chain==='robinhood' ? hoodClient : ethClient;

function need(name) { const value=process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name} in .env`); return value; }
function source() { const account=privateKeyToAccount(need('SOURCE_PK')); if (getAddress(need('SOURCE_ADD')) !== account.address) throw new Error('SOURCE_ADD does not match SOURCE_PK'); return account; }
function destinations() { const addresses=[1,2,3].map(i=>{ const address=getAddress(need(`DEST${i}_ADD`)); const key=process.env[`DEST${i}_PK`]?.trim(); if (key && privateKeyToAccount(key).address !== address) throw new Error(`DEST${i}_ADD does not match DEST${i}_PK`); return address; }); if(new Set(addresses).size!==3 || addresses.includes(getAddress(need('SOURCE_ADD')))) throw new Error('Source and three recipients must be distinct'); return addresses; }
async function confidential() { const key=(process.env.CONFIDENTIAL_PK?.trim() || (existsSync(secretFile) ? (await readFile(secretFile,'utf8')).trim() : null)); if (!key) throw new Error('Run init to create the confidential signer'); return privateKeyToAccount(key); }
async function save(value) { await mkdir(secretDir,{recursive:true,mode:0o700}); const tmp=`${stateFile}.${process.pid}.tmp`; await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600}); await chmod(tmp,0o600); await rename(tmp,stateFile); }
async function load() {
  if (!existsSync(stateFile)) throw new Error('Run prepare first');
  const state=JSON.parse(await readFile(stateFile,'utf8'));
  if((state.destinationChain??'ethereum')!==destinationChain) throw new Error(`Saved run targets ${state.destinationChain??'ethereum'}; DESTINATION is ${destinationChain}`);
  return state;
}
function print(value) { console.log(JSON.stringify(value,(_key,v)=>typeof v==='bigint'?v.toString():v,2)); }
function requirePhase(state,phase) { if(state.phase!==phase) throw new Error(`Expected phase ${phase}; current phase is ${state.phase}`); }
function safeError(response) { return `${response.status} ${response.statusText}`; }
async function api(path,{method='GET',body,token}={}) {
  const key=need('AURORA_API_KEY');
  const response=await fetch(`https://intents-api.aurora.dev/api/${path}/${encodeURIComponent(key)}`,{method,headers:{'content-type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
  if(!response.ok) throw new Error(`Aurora ${path.split('?')[0]} failed: ${safeError(response)}. Inspect the provider response locally; no credential or response body is logged.`);
  return response.json();
}
async function tokens() { const result=await api('tokens'); if(!Array.isArray(result.tokens)) throw new Error('Aurora returned no token registry'); return result.tokens; }
function selectToken(all,chain,contract,override) {
  const choices=all.filter(t=>t.blockchain===chain && t.symbol?.toUpperCase()==='USDC' && (!contract || t.contractAddress?.toLowerCase()===contract.toLowerCase()) && (!override || t.assetId===override));
  if(choices.length!==1) throw new Error(`Expected one ${chain} USDC token; found ${choices.length}. Run tokens, then set the exact ${chain==='monad'?'MONAD':chain==='eth'?'ETHEREUM':'PRIVATE'}_ASSET_ID in .env.`);
  return choices[0];
}
async function robinhoodTarget() {
  const target=await loadTarget(targetSetFile,need('TARGET'));
  if(process.env.ROUTE?.trim()!=='usdg_then_swap'||target.routeType!=='direct') return target;
  if(!target.contract||getAddress(target.contract)===usdgContract) throw new Error(`${target.symbol} cannot use the USDG swap route`);
  return {...target,routeType:'usdg_then_swap'};
}
function selectRobinhoodToken(all,target) {
  const symbol=target.routeType==='direct'?target.symbol:'USDG';
  const override=process.env.ROBINHOOD_ASSET_ID?.trim();
  const choices=all.filter(t=>t.blockchain==='hood'&&t.symbol===symbol&&(!override||t.assetId===override));
  if(choices.length!==1) throw new Error(`Expected one Robinhood ${symbol} token; found ${choices.length}. Run tokens, then set ROBINHOOD_ASSET_ID.`);
  if(target.routeType==='direct'&&choices[0].assetId!==target.assetId) throw new Error('Robinhood payout asset differs from the pinned target set');
  if(symbol==='USDG'&&getAddress(choices[0].contractAddress)!==usdgContract) throw new Error('Robinhood USDG asset uses an unexpected contract');
  return choices[0];
}
async function assetSet() {
  const all=await tokens(); const source=selectToken(all,'monad',process.env.MONAD_USDC_CONTRACT,process.env.MONAD_ASSET_ID);
  const base={source,private:chooseConfidentialAsset(all,source,process.env.PRIVATE_ASSET_ID)};
  if(destinationChain==='ethereum') return {...base,destination:selectToken(all,'eth',process.env.ETHEREUM_USDC_CONTRACT,process.env.ETHEREUM_ASSET_ID)};
  const target=await robinhoodTarget();
  return {...base,destination:selectRobinhoodToken(all,target),target};
}
async function assertChains(chain=destinationChain) {
  if(await monadClient.getChainId()!==143) throw new Error('Monad RPC is not chain 143');
  if(chain==='ethereum'&&await ethClient.getChainId()!==1) throw new Error('Ethereum RPC is not chain 1');
  if(chain==='robinhood'&&await hoodClient.getChainId()!==robinhoodChainId) throw new Error(`Robinhood RPC is not chain ${robinhoodChainId}`);
}
async function verifyDestinationToken(chain,token) {
  if(!token.contractAddress) { if(chain!=='robinhood'||token.symbol!=='ETH'||token.decimals!==18) throw new Error('Only Robinhood ETH may be a native destination asset'); return; }
  const client=destinationClient(chain), address=getAddress(token.contractAddress);
  const [decimals,symbol]=await Promise.all([client.readContract({address,abi:erc20Abi,functionName:'decimals'}),client.readContract({address,abi:erc20Abi,functionName:'symbol'})]);
  const expected=chain==='ethereum'?{symbol:'USDC',decimals:6}:{symbol:token.symbol,decimals:token.decimals};
  if(symbol!==expected.symbol||decimals!==expected.decimals) throw new Error(`Destination token is not ${expected.decimals}-decimal ${expected.symbol}`);
}
async function destinationReceived(chain,token,recipient,{fromBlock,fromBalance}) {
  const client=destinationClient(chain);
  if(!token.contractAddress) return {received:(await client.getBalance({address:recipient}))-BigInt(fromBalance??0),txHashes:[]};
  const logs=await client.getLogs({address:getAddress(token.contractAddress),event:transferEvent,args:{to:recipient},fromBlock:BigInt(fromBlock)});
  return {received:logs.reduce((sum,log)=>sum+(log.args.value??0n),0n),txHashes:[...new Set(logs.map(l=>l.transactionHash))]};
}
async function auth(account) {
  const saltResponse=await fetch(process.env.NEAR_RPC_URL || 'https://rpc.mainnet.near.org',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'auth-salt',method:'query',params:{request_type:'call_function',finality:'final',account_id:'intents.near',method_name:'current_salt',args_base64:''}}),signal:AbortSignal.timeout(20000)});
  if(!saltResponse.ok) throw new Error(`Public Intents salt lookup failed: ${saltResponse.status}`);
  const saltResult=await saltResponse.json();
  if(!Array.isArray(saltResult.result?.result)) throw new Error('Public Intents salt response is invalid');
  const salt=JSON.parse(Buffer.from(saltResult.result.result).toString('utf8'));
  const payload=buildAuthPayload(account.address,salt);
  const signature=encodeAuroraSignature(await account.signMessage({message:payload}));
  const result=await api('auth/authenticate',{method:'POST',body:{signedData:{standard:'erc191',payload,signature}}});
  if(!result.accessToken) throw new Error('Aurora did not issue an access token');
  return result.accessToken;
}
async function privateBalance(account) { const token=await auth(account); const result=await api('account/balances',{token}); if(!Array.isArray(result.balances)) throw new Error('Invalid private balance response'); return result.balances; }
function authRejected(error) { return error.message.startsWith('Aurora auth/authenticate failed: 401 '); }
function privateTokenIdFromIntent(intent,assetId) {
  let message; try { message=JSON.parse(intent.payload); } catch { throw new Error('Unsigned private intent is not JSON'); }
  const tokenId=Object.keys(message.intents?.[0]?.tokens??{})[0];
  if(typeof tokenId!=='string'||!tokenId.startsWith('imt:')||!tokenId.endsWith(`:${assetId}`)||!/^[0-9a-f]{64}$/.test(tokenId.slice(4,-assetId.length-1))) throw new Error('Unsigned private intent token does not wrap the quoted source asset');
  return tokenId;
}
async function quote(request) { const result=await api('quote',{method:'POST',body:request}); assertQuote(request,result); return result; }
function quoteRequest({depositType,recipientType,recipient,refundType,refundTo,originAsset,destinationAsset,amount}) { return {dry:false,swapType:'EXACT_INPUT',depositType,recipientType,recipient,refundType,refundTo,originAsset,destinationAsset,amount:String(amount),slippageTolerance:100,confidentiality:'advanced'}; }
async function fundingQuote(f,c,assets,budget) {
  const token=getAddress(assets.source.contractAddress);
  const context=await createMonadPaymaster({chain:monad,client:monadClient,owner:f,token});
  const probe=await prepareMonadFunding(context,{token,recipient:'0x000000000000000000000000000000000000dEaD',amount:1n});
  let amount=fundingAmount(budget,probe.feeCapAtoms);
  for(let attempt=0;attempt<4;attempt++) {
    const request=quoteRequest({depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:c.address.toLowerCase(),refundType:'ORIGIN_CHAIN',refundTo:f.address,originAsset:assets.source.assetId,destinationAsset:assets.private.assetId,amount});
    const result=await quote(request);
    if(BigInt(result.quote.amountIn)!==amount) throw new Error('Aurora funding quote changed its source amount');
    const operation=await prepareMonadFunding(context,{token,recipient:result.quote.depositAddress,amount});
    const next=fundingAmount(budget,operation.feeCapAtoms);
    if(next===amount) return {request,result,feeCapAtoms:operation.feeCapAtoms};
    amount=next;
  }
  throw new Error('USDC paymaster fee did not stabilize; no source operation was signed');
}
async function routeStatus(entry) { if(!entry?.quote?.quote?.depositAddress) return null; const url=new URL(`https://intents-api.aurora.dev/api/status/${encodeURIComponent(need('AURORA_API_KEY'))}`); url.searchParams.set('depositAddress',entry.quote.quote.depositAddress); if(entry.quote.quote.depositMemo) url.searchParams.set('depositMemo',entry.quote.quote.depositMemo); const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); if(!response.ok) throw new Error(`Aurora status failed: ${safeError(response)}`); return (await response.json()).status; }
function publicView(state) { return {phase:state.phase,destinationChain:state.destinationChain??'ethereum',target:state.target&&{symbol:state.target.symbol,routeType:state.target.routeType,contract:state.target.contract},swaps:state.swaps?.map((s,i)=>s&&({index:i+1,status:s.status,amountInAtoms:s.amountInAtoms,minOutAtoms:s.minOutAtoms,feeCapAtoms:s.feeCapAtoms,userOperationHash:s.signed?.userOperationHash,txHash:s.txHash,receivedAtoms:s.receivedAtoms,netGasAtoms:s.netGasAtoms})),fusion:state.fusion?.map((s,i)=>s&&({index:i+1,status:s.status,symbol:s.symbol,preset:s.preset,amountInAtoms:s.amountInAtoms,minOutAtoms:s.minOutAtoms,orderHash:s.signed?.orderHash,txHashes:s.txHashes,resolvers:s.resolvers,receivedAtoms:s.receivedAtoms})),source:state.source,confidential:state.confidential,creditBasis:state.creditBasis,creditedAtoms:state.creditedAtoms,deposit:{status:state.deposit?.status,routeStatus:state.deposit?.routeStatus,txHash:state.deposit?.txHash,userOperationHash:state.deposit?.signedUserOperation?.userOperationHash,route:state.deposit?.quote?.quote?.depositAddress},payouts:state.payouts?.map((p,i)=>({index:i+1,recipient:p.recipient,status:p.status,routeStatus:p.routeStatus,receivedAtoms:p.receivedAtoms,sourceAtoms:p.sourceAtoms,minDestinationAtoms:p.quote?.quote?.minAmountOut,intentHash:p.intentHash})),postTransfer:state.postTransfer&&{status:state.postTransfer.status,amountAtoms:state.postTransfer.amountAtoms,feeCapAtoms:state.postTransfer.feeCapAtoms,userOperationHash:state.postTransfer.signed?.userOperationHash,txHash:state.postTransfer.txHash,netGasAtoms:state.postTransfer.netGasAtoms}}; }
async function postContext(state) {
  if((state.destinationChain??'ethereum')!=='ethereum') throw new Error('A1 -> A3 is not part of the Robinhood swap flow; it publicly links destination wallets');
  if(state.phase!=='destinations_delivered'||state.payouts?.length!==3||!state.payouts.every(p=>p.status==='delivered')) throw new Error('Three Ethereum payouts must be confirmed first');
  if(state.postTransfer) throw new Error('Post-transfer already signed or submitted; run post-status');
  const recipients=destinations();
  if(recipients.some((address,i)=>address!==getAddress(state.recipients[i]))) throw new Error('Destination addresses differ from the accepted plan');
  const owner=privateKeyToAccount(need('DEST1_PK'));
  if(owner.address!==recipients[0]) throw new Error('DEST1_PK does not match the first recipient');
  const token=getAddress(state.assets.destination.contractAddress);
  if(token!==ethereumUsdc) throw new Error('Post-transfer requires canonical Ethereum USDC');
  const context=await createCircleContext({client:ethClient,chain:ethereum,owner,recipient:recipients[2],token});
  if(context.balance>BigInt(state.payouts[0].receivedAtoms??0)||context.balance>usdcAtoms) throw new Error('A1 has unaccounted USDC beyond its confirmed payout');
  return context;
}
function swapIndex(arg,command) { const index=Number(arg)-1; if(!Number.isInteger(index)||index<0||index>2) throw new Error(`Use ${command} 1, 2 or 3`); return index; }
async function swapContext(state,index) {
  if(state.destinationChain!=='robinhood'||state.target?.routeType!=='usdg_then_swap') throw new Error('Swap commands apply only to a Robinhood usdg_then_swap target');
  const p=state.payouts?.[index]; if(p?.status!=='delivered') throw new Error(`Payout ${index+1} must be delivered before its swap`);
  if(state.swaps?.[index]&&state.swaps[index].status!=='failed') throw new Error(`Swap ${index+1} already signed or submitted; run swap-status ${index+1}`);
  const owner=privateKeyToAccount(need(`DEST${index+1}_PK`));
  if(owner.address!==getAddress(p.recipient)) throw new Error(`DEST${index+1}_PK does not match payout ${index+1}`);
  if(await hoodClient.getBalance({address:owner.address})!==0n) throw new Error(`Destination ${index+1} holds ETH; this run cannot prove the zero-ETH USDG gas path`);
  const balance=await hoodClient.readContract({address:usdgContract,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]});
  if(balance<=0n||balance>BigInt(p.receivedAtoms)) throw new Error(`Destination ${index+1} USDG differs from its confirmed payout`);
  const context=await createRobinhoodPaymaster({client:hoodClient,owner,token:usdgContract});
  return {context,balance,target:getAddress(state.target.contract)};
}
function fusionOwner(state,index) {
  const p=state.payouts?.[index];
  const owner=privateKeyToAccount(need(`DEST${index+1}_PK`));
  if(owner.address!==getAddress(p.recipient)) throw new Error(`DEST${index+1}_PK does not match payout ${index+1}`);
  return owner;
}
async function fusionContext(state,index) {
  if(state.destinationChain!=='robinhood'||getAddress(state.assets?.destination?.contractAddress??'0x0000000000000000000000000000000000000000')!==usdgContract) throw new Error('Fusion commands apply only to Robinhood runs that paid out USDG');
  const p=state.payouts?.[index]; if(p?.status!=='delivered') throw new Error(`Payout ${index+1} must be delivered before its Fusion order`);
  const previous=state.fusion?.[index];
  if(previous&&!fusionRetryable.includes(previous.status)) throw new Error(`Fusion order ${index+1} is ${previous.status}; run fusion-status ${index+1}`);
  const target=await loadTarget(targetSetFile,fusionTarget);
  if(!target.contract||getAddress(target.contract)===usdgContract||target.routeType!=='usdg_then_swap') throw new Error(`${fusionTarget} is not a Stock Token in the pinned target set`);
  const owner=fusionOwner(state,index);
  if(await hoodClient.getBalance({address:owner.address})!==0n) throw new Error(`Destination ${index+1} holds ETH; this run cannot prove the gasless Fusion path`);
  const balance=await hoodClient.readContract({address:usdgContract,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]});
  if(balance<=0n||balance>BigInt(p.receivedAtoms)) throw new Error(`Destination ${index+1} USDG differs from its confirmed payout`);
  const fusion=await createFusion({owner,client:hoodClient});
  return {fusion,owner,balance,target:{...target,contract:getAddress(target.contract)}};
}
async function fusionReconcile(s,status) {
  const sum=list=>list.reduce((total,l)=>total+l.args.value,0n);
  let swapped=0n, received=0n; const resolvers=new Set();
  for(const fill of status.fills) {
    const receipt=await hoodClient.getTransactionReceipt({hash:fill.txHash});
    if(receipt.status!=='success') throw new Error(`Fusion fill ${fill.txHash} reverted`);
    resolvers.add(getAddress(receipt.from));
    const transfers=parseEventLogs({abi:[transferEvent],logs:receipt.logs,strict:false});
    swapped+=sum(transfers.filter(l=>getAddress(l.address)===usdgContract&&getAddress(l.args.from)===getAddress(s.wallet)));
    received+=sum(transfers.filter(l=>getAddress(l.address)===getAddress(s.target)&&getAddress(l.args.to)===getAddress(s.wallet)));
  }
  const filled=status.fills.reduce((total,f)=>total+BigInt(f.filledMakerAmount),0n);
  const [afterUsdg,afterTarget,eth]=await Promise.all([
    hoodClient.readContract({address:usdgContract,abi:erc20Abi,functionName:'balanceOf',args:[s.wallet]}),
    hoodClient.readContract({address:s.target,abi:erc20Abi,functionName:'balanceOf',args:[s.wallet]}),
    hoodClient.getBalance({address:s.wallet}),
  ]);
  if(swapped!==filled||afterUsdg!==BigInt(s.beforeUsdgAtoms)-swapped||afterTarget-BigInt(s.beforeTargetAtoms)!==received||eth!==0n) throw new Error('Fusion fill receipts or balances do not reconcile; inspect the fill transactions');
  return {swapped,received,afterUsdg,resolvers:[...resolvers],txHashes:status.fills.map(f=>f.txHash)};
}

export async function run(command,arg) {
  if(!['ethereum','robinhood'].includes(destinationChain)) throw new Error('DESTINATION must be ethereum or robinhood');
  if(command==='check') { const f=source(); const d=destinations(); print({source:f.address,destinations:d,confidential:existsSync(secretFile)||!!process.env.CONFIDENTIAL_PK,auroraApiKeyConfigured:!!process.env.AURORA_API_KEY,pimlicoApiKeyConfigured:!!process.env.PIMLICO_API_KEY,oneInchApiKeyConfigured:!!process.env.ONEINCH_API_KEY,destinationChain,target:process.env.TARGET?.trim()||null,route:process.env.ROUTE?.trim()||null,sourceCapUSDC:'10',weights:'30/30/40'}); return; }
  if(command==='assets') {
    if(await hoodClient.getChainId()!==robinhoodChainId) throw new Error(`Robinhood RPC is not chain ${robinhoodChainId}`);
    const set=await buildTargetSet({tokens:await tokens(),client:hoodClient});
    await mkdir(secretDir,{recursive:true,mode:0o700}); await writeFile(targetSetFile,JSON.stringify(set,null,2),{mode:0o600});
    print({file:targetSetFile,checkedAt:set.checkedAt,referenceUSDG:formatUnits(BigInt(set.referenceUSDG),6),maxImpactBps:set.maxImpactBps,direct:set.direct.map(t=>t.symbol),stocks:set.stocks.map(t=>`${t.symbol} (${t.impactBps} bps)`),skipped:set.skipped.length}); return;
  }
  if(command==='init') { source(); destinations(); if(!process.env.CONFIDENTIAL_PK && !existsSync(secretFile)) { await mkdir(secretDir,{recursive:true,mode:0o700}); await writeFile(secretFile,generatePrivateKey(),{mode:0o600}); } const c=await confidential(); print({confidentialAccount:c.address,secretLocation:process.env.CONFIDENTIAL_PK?'CONFIDENTIAL_PK':secretFile}); return; }
  if(command==='tokens') { const all=await tokens(); print(all.filter(t=>(t.symbol?.toUpperCase()==='USDC' && ['monad','near','eth'].includes(t.blockchain))||t.blockchain==='hood').map(t=>({assetId:t.assetId,blockchain:t.blockchain,decimals:t.decimals,contractAddress:t.contractAddress}))); return; }
  if(command==='prepare') {
    if(existsSync(stateFile)) throw new Error('State already exists; inspect it before starting a new run');
    const f=source(), c=await confidential(); destinations(); await assertChains(); const assets=await assetSet();
    if(assets.source.decimals!==6 || assets.private.decimals!==6) throw new Error('Unexpected USDC decimals');
    const contract=getAddress(assets.source.contractAddress);
    const chainDecimals=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'decimals'});
    const chainSymbol=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'symbol'});
    const balance=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    const nativeBalance=await monadClient.getBalance({address:f.address});
    await verifyDestinationToken(destinationChain,assets.destination);
    if(assets.target?.routeType==='usdg_then_swap') {
      const liquidity=await checkLiquidity(getAddress(assets.target.contract),liquidityConfig());
      if(!liquidity.passes) throw new Error(`${assets.target.symbol} no longer passes the liquidity rule (${liquidity.impactBps} bps); no source transaction was signed`);
    }
    if(chainDecimals!==6 || chainSymbol!=='USDC') throw new Error('Source token must be verified six-decimal USDC');
    const budget=sourceBudget(balance);
    if(nativeBalance!==0n) throw new Error('Source holds MON; this run cannot prove the zero-MON paymaster path');
    const {request,result:funding,feeCapAtoms}=await fundingQuote(f,c,assets,budget);
    const recipients=destinations(); const estimates=[];
    const projected=splitSourceBudget(BigInt(funding.quote.amountOut));
    for(let i=0;i<3;i++) {
      const payoutRequest=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:c.address.toLowerCase(),originAsset:assets.private.assetId,destinationAsset:assets.destination.assetId,amount:projected[i]});
      let payoutQuote; try { payoutQuote=await quote(payoutRequest); } catch(error) { throw new Error(`Payout ${i+1} is unavailable for the projected private balance: ${error.message}. No source transaction was signed.`); }
      estimates.push({recipient:i+1,projectedSourceUSDC:formatUnits(projected[i],6),estimatedDestination:`${formatUnits(BigInt(payoutQuote.quote.amountOut),assets.destination.decimals)} ${assets.destination.symbol}`,minimumDestination:`${formatUnits(BigInt(payoutQuote.quote.minAmountOut),assets.destination.decimals)} ${assets.destination.symbol}`});
    }
    const state={version:3,phase:'prepared',createdAt:new Date().toISOString(),destinationChain,target:assets.target,source:f.address,confidential:c.address.toLowerCase(),recipients,assets,deposit:{status:'quoted',request,quote:funding,budgetAtoms:budget.toString(),feeCapAtoms:feeCapAtoms.toString()},payouts:[]}; await save(state);
    print({phase:'prepared',destinationChain,target:assets.target&&`${assets.target.symbol} via ${assets.target.routeType}`,source:f.address,confidential:c.address,depositAddress:funding.quote.depositAddress,sourceBudgetUSDC:formatUnits(budget,6),sourceTransferUSDC:formatUnits(BigInt(funding.quote.amountIn),6),maximumMonadGasUSDC:formatUnits(feeCapAtoms,6),expectedPrivateUSDC:formatUnits(BigInt(funding.quote.amountOut),6),projectedPayouts:estimates,deadline:funding.quote.deadline}); return;
  }
  if(command==='requote') {
    const state=await load(); requirePhase(state,'prepared'); const f=source(),c=await confidential();
    if(f.address!==state.source||c.address.toLowerCase()!==state.confidential) throw new Error('Wallet changed');
    const budget=BigInt(state.deposit.budgetAtoms);
    if(budget<=0n||budget>usdcAtoms) throw new Error('Saved source budget is outside the 10 USDC cap');
    const {request,result,feeCapAtoms}=await fundingQuote(f,c,state.assets,budget);
    const projected=splitSourceBudget(BigInt(result.quote.amountOut));
    for(let i=0;i<3;i++) {
      const request=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:state.recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:state.confidential,originAsset:state.assets.private.assetId,destinationAsset:state.assets.destination.assetId,amount:projected[i]});
      try { await quote(request); } catch(error) { throw new Error(`Payout ${i+1} unavailable after requote: ${error.message}. No source transaction was signed.`); }
    }
    state.deposit.request=request; state.deposit.quote=result; state.deposit.feeCapAtoms=feeCapAtoms.toString(); await save(state); print({depositAddress:result.quote.depositAddress,sourceTransferUSDC:formatUnits(BigInt(result.quote.amountIn),6),maximumMonadGasUSDC:formatUnits(feeCapAtoms,6),deadline:result.quote.deadline,payoutsFeasible:true}); return;
  }
  if(command==='fund') {
    const state=await load(); requirePhase(state,'prepared'); const f=source(); if(f.address!==state.source) throw new Error('Source wallet changed'); await assertChains();
    const q=state.deposit.quote.quote; if(Date.parse(q.deadline)<=Date.now()) throw new Error('Funding quote expired; no transaction signed');
    if(getAddress(q.depositAddress)===f.address) throw new Error('Funding quote points back to source');
    const contract=getAddress(state.assets.source.contractAddress);
    const amount=BigInt(q.amountIn);
    const budget=BigInt(state.deposit.budgetAtoms);
    const balance=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    if(budget<=0n||budget>usdcAtoms||balance<budget||amount<=0n) throw new Error('Source balance no longer covers the saved budget, or the budget exceeds 10 USDC');
    if(await monadClient.getBalance({address:f.address})!==0n) throw new Error('Source holds MON; zero-MON paymaster test stopped');
    const context=await createMonadPaymaster({chain:monad,client:monadClient,owner:f,token:contract});
    const operation=await prepareMonadFunding(context,{token:contract,recipient:q.depositAddress,amount});
    if(operation.feeCapAtoms!==budget-amount) throw new Error('Monad USDC gas fee changed; run requote before funding');
    const signed=await signMonadFunding(context,operation.prepared);
    state.deposit.signedUserOperation=signed; state.deposit.status='signed'; state.phase='funding'; await save(state);
    try { await submitMonadFunding(signed); state.deposit.status='submitted'; await save(state); } catch { throw new Error('Submission outcome unknown. Run status before resubmitting the saved UserOperation.'); }
    print({phase:state.phase,userOperationHash:signed.userOperationHash,sourceTransferUSDC:formatUnits(amount,6),maximumMonadGasUSDC:formatUnits(operation.feeCapAtoms,6)}); return;
  }
  if(command==='rebroadcast') {
    const state=await load(); if(state.phase!=='funding'||!state.deposit.signedUserOperation) throw new Error('No saved source UserOperation');
    await assertChains(); const signed=state.deposit.signedUserOperation;
    const receipt=await monadFundingReceipt(signed.userOperationHash);
    if(receipt) { print({userOperationHash:signed.userOperationHash,txHash:receipt.receipt.transactionHash,success:receipt.success}); return; }
    const route=await routeStatus(state.deposit); if(route!=='PENDING_DEPOSIT'&&route!=='KNOWN_DEPOSIT_TX') throw new Error(`Aurora route status ${route}; inspect before rebroadcast`);
    await submitMonadFunding(signed); state.deposit.status='submitted'; await save(state); print({userOperationHash:signed.userOperationHash,reusedSignedOperation:true}); return;
  }
  if(command==='balance') { const state=await load(); const c=await confidential(); if(c.address.toLowerCase()!==state.confidential) throw new Error('Confidential account changed'); const balances=await privateBalance(c); print({confidential:c.address,balances}); return; }
  if(command==='plan') {
    const state=await load(); requirePhase(state,'credited'); const c=await confidential(); if(c.address.toLowerCase()!==state.confidential) throw new Error('Confidential account changed'); await assertChains();
    let available=BigInt(state.creditedAtoms??0);
    try {
      const balances=await privateBalance(c);
      const held=selectPrivateBalance(balances,state.assets.private.assetId);
      available=BigInt(held.available); state.creditBasis='authenticated_balance';
    } catch(error) { if(!authRejected(error)) throw error; if(state.creditBasis!=='route_success_minimum') throw new Error('No authenticated or route-confirmed private balance'); }
    if(available<=0n || available>usdcAtoms) throw new Error('Private available amount outside test cap');
    const portions=splitSourceBudget(available); const destination=destinationClient(destinationChain); const fromBlock=await destination.getBlockNumber(); const payouts=[];
    for(let i=0;i<3;i++) {
      const request=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:state.recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:state.confidential,originAsset:state.assets.private.assetId,destinationAsset:state.assets.destination.assetId,amount:portions[i]});
      const result=await quote(request); if(BigInt(result.quote.amountIn)>portions[i]) throw new Error(`Payout ${i+1} exceeds reserved source input`);
      if(i===0) {
        const generated=await api('generate-intent',{method:'POST',body:{type:'swap_transfer',standard:'erc191',signerId:state.confidential,depositAddress:result.quote.depositAddress}});
        const privateId=privateTokenIdFromIntent(generated.intent,state.assets.private.assetId);
        if(state.privateTokenId&&state.privateTokenId!==privateId) throw new Error('Private token changed across quotes');
        state.privateTokenId=privateId;
        validatePreparedIntent(generated.intent,{signerId:state.confidential,verifyingContract:confidentialContract,depositAddress:result.quote.depositAddress,tokenId:privateId,amount:portions[i],now:new Date()});
      }
      const fromBalance=state.assets.destination.contractAddress?undefined:(await destination.getBalance({address:state.recipients[i]})).toString();
      payouts.push({status:'quoted',recipient:state.recipients[i],sourceAtoms:portions[i].toString(),request,quote:result,fromBlock:fromBlock.toString(),fromBalance});
    }
    if(payouts.reduce((sum,p)=>sum+BigInt(p.sourceAtoms),0n)>available) throw new Error('Payouts exceed private balance');
    state.creditedAtoms=available.toString(); state.payouts=payouts; state.phase='planned'; await save(state);
    print({phase:'planned',creditBasis:state.creditBasis,availableUSDC:formatUnits(available,6),payouts:payouts.map((p,i)=>({recipient:i+1,sourceUSDC:formatUnits(BigInt(p.sourceAtoms),6),estimatedDestination:`${formatUnits(BigInt(p.quote.quote.amountOut),state.assets.destination.decimals)} ${state.assets.destination.symbol}`,minimumDestination:`${formatUnits(BigInt(p.quote.quote.minAmountOut),state.assets.destination.decimals)} ${state.assets.destination.symbol}`,deadline:p.quote.quote.deadline}))}); return;
  }
  if(command==='replan') { const state=await load(); requirePhase(state,'planned'); if(state.payouts.some(p=>p.signedData||p.intentHash)) throw new Error('Signed payout exists; reconcile before replanning'); state.payouts=[]; state.phase='credited'; await save(state); return run('plan'); }
  if(command==='payout') {
    const index=Number(arg)-1; if(!Number.isInteger(index)||index<0||index>2) throw new Error('Use payout 1, 2 or 3');
    const state=await load(); if(state.phase!=='planned'&&state.phase!=='distributing') throw new Error('Plan and verify private credit before payout');
    const p=state.payouts[index]; if(!p||p.status!=='quoted') throw new Error('Payout already signed/submitted; run status');
    if(Date.parse(p.quote.quote.deadline)<=Date.now()) throw new Error('Payout quote expired; no intent signed');
    for(let j=0;j<index;j++) if(!['submitted','delivered'].includes(state.payouts[j].status)) throw new Error('Earlier payout unresolved');
    const c=await confidential(); if(c.address.toLowerCase()!==state.confidential) throw new Error('Confidential signer changed');
    const generated=await api('generate-intent',{method:'POST',body:{type:'swap_transfer',standard:'erc191',signerId:state.confidential,depositAddress:p.quote.quote.depositAddress}});
    validatePreparedIntent(generated.intent,{signerId:state.confidential,verifyingContract:confidentialContract,depositAddress:p.quote.quote.depositAddress,tokenId:state.privateTokenId,amount:BigInt(p.sourceAtoms),now:new Date()});
    const signedData={...generated.intent,signature:encodeAuroraSignature(await c.signMessage({message:generated.intent.payload}))};
    p.signedData=signedData; p.status='signed'; state.phase='distributing'; await save(state);
    try { const submitted=await api('submit-intent',{method:'POST',body:{type:'swap_transfer',signedData}}); if(!submitted.intentHash) throw new Error('No intent hash'); p.intentHash=submitted.intentHash; p.status='submitted'; await save(state); } catch { throw new Error('Submission outcome unknown. Signed intent saved; run status. Do not generate another intent.'); }
    print({recipient:index+1,status:p.status,intentHash:p.intentHash}); return;
  }
  if(command==='resubmit') {
    const index=Number(arg)-1; if(!Number.isInteger(index)||index<0||index>2) throw new Error('Use resubmit 1, 2 or 3');
    const state=await load(); const p=state.payouts?.[index]; if(!p?.signedData||!['signed','submitted'].includes(p.status)) throw new Error('No unresolved saved intent');
    const route=await routeStatus(p); if(route!=='PENDING_DEPOSIT'&&route!=='INCOMPLETE_DEPOSIT') throw new Error(`Aurora route status ${route}; inspect before resubmission`);
    const submitted=await api('submit-intent',{method:'POST',body:{type:'swap_transfer',signedData:p.signedData}});
    if(!submitted.intentHash) throw new Error('Aurora returned no intent hash'); p.intentHash=submitted.intentHash; p.status='submitted'; await save(state); print({recipient:index+1,intentHash:p.intentHash,reusedSignedIntent:true}); return;
  }
  if(command==='post-preview') {
    const state=await load(); await assertChains(); const context=await postContext(state);
    const selected=await prepareCircleTransfer(context);
    print({source:context.owner.address,recipient:context.recipient,chainId:1,token:context.token,paymaster:circlePaymaster,
      a1BalanceUSDC:formatUnits(context.balance,6),transferUSDC:formatUnits(selected.amount,6),maximumGasUSDC:formatUnits(selected.feeCap,6),publiclyLinksA1AndA3:true}); return;
  }
  if(command==='post-send') {
    const state=await load(); await assertChains(); const context=await postContext(state);
    const beforeA3=await ethClient.readContract({address:context.token,abi:erc20Abi,functionName:'balanceOf',args:[context.recipient]});
    const selected=await prepareCircleTransfer(context);
    const signed=await signCircleTransfer(context,selected.prepared);
    state.postTransfer={status:'signed',source:context.owner.address,recipient:context.recipient,token:context.token,amountAtoms:selected.amount.toString(),feeCapAtoms:selected.feeCap.toString(),beforeA1Atoms:context.balance.toString(),beforeA3Atoms:beforeA3.toString(),signed};
    state.phase='post_transfer_pending'; await save(state);
    try { await submitCircleTransfer(signed); state.postTransfer.status='submitted'; await save(state); }
    catch { throw new Error('Ethereum submission outcome unknown. Run post-status before resubmitting the saved UserOperation.'); }
    print({status:'submitted',userOperationHash:signed.userOperationHash,transferUSDC:formatUnits(selected.amount,6),maximumGasUSDC:formatUnits(selected.feeCap,6)}); return;
  }
  if(command==='post-status') {
    const state=await load(); const p=state.postTransfer; if(!p?.signed) throw new Error('No signed A1 to A3 transfer');
    await assertChains(); const op=await circleTransferReceipt(p.signed.userOperationHash);
    if(!op) { print({status:p.status,userOperationHash:p.signed.userOperationHash,receipt:null}); return; }
    const receipt=await ethClient.getTransactionReceipt({hash:op.receipt.transactionHash});
    if(!op.success||receipt.status!=='success') { p.status='failed'; p.txHash=receipt.transactionHash; await save(state); print({status:'failed',txHash:p.txHash}); return; }
    const transferEvent=parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
    const sponsorEvent=parseAbiItem('event UserOperationSponsored(address indexed token, address indexed sender, bytes32 userOpHash, uint256 nativeTokenPrice, uint256 actualTokenNeeded, uint256 feeTokenAmount)');
    const sent=parseEventLogs({abi:[transferEvent],logs:receipt.logs,strict:false}).filter(l=>getAddress(l.address)===getAddress(p.token)&&getAddress(l.args.from)===getAddress(p.source)&&getAddress(l.args.to)===getAddress(p.recipient)&&l.args.value===BigInt(p.amountAtoms));
    const fees=parseEventLogs({abi:[sponsorEvent],logs:receipt.logs,strict:false}).filter(l=>getAddress(l.address)===circlePaymaster&&getAddress(l.args.sender)===getAddress(p.source)&&getAddress(l.args.token)===getAddress(p.token)&&l.args.userOpHash.toLowerCase()===p.signed.userOperationHash.toLowerCase());
    const [afterA1,afterA3]=await Promise.all([ethClient.readContract({address:p.token,abi:erc20Abi,functionName:'balanceOf',args:[p.source]}),ethClient.readContract({address:p.token,abi:erc20Abi,functionName:'balanceOf',args:[p.recipient]})]);
    const netGas=BigInt(p.beforeA1Atoms)-afterA1-BigInt(p.amountAtoms);
    if(sent.length!==1||fees.length!==1||netGas<0n||netGas>BigInt(p.feeCapAtoms)||afterA3-BigInt(p.beforeA3Atoms)!==BigInt(p.amountAtoms)) throw new Error('Post-transfer receipts or balances do not reconcile; inspect the transaction before retrying');
    p.status='complete'; p.txHash=receipt.transactionHash; p.netGasAtoms=netGas.toString(); p.afterA1Atoms=afterA1.toString(); p.afterA3Atoms=afterA3.toString(); p.paymasterActualTokenNeeded=fees[0].args.actualTokenNeeded.toString(); p.paymasterFeeTokenAmount=fees[0].args.feeTokenAmount.toString(); state.phase='completed'; await save(state);
    print({status:'complete',txHash:p.txHash,transferUSDC:formatUnits(BigInt(p.amountAtoms),6),netGasUSDC:formatUnits(netGas,6),a1RefundRemainderUSDC:formatUnits(afterA1,6),a3BalanceUSDC:formatUnits(afterA3,6)}); return;
  }
  if(command==='post-resubmit') {
    const state=await load(); const p=state.postTransfer; if(!p?.signed||!['signed','submitted'].includes(p.status)) throw new Error('No unresolved signed post-transfer operation');
    const receipt=await circleTransferReceipt(p.signed.userOperationHash);
    if(receipt) { print({status:'receipt_found',txHash:receipt.receipt.transactionHash}); return; }
    await submitCircleTransfer(p.signed); p.status='submitted'; await save(state); print({status:'submitted',userOperationHash:p.signed.userOperationHash,reusedSignedOperation:true}); return;
  }
  if(command==='status') {
    const state=await load(); await assertChains();
    if(state.deposit?.signedUserOperation) { const receipt=await monadFundingReceipt(state.deposit.signedUserOperation.userOperationHash); if(receipt) { state.deposit.txHash=receipt.receipt.transactionHash; state.deposit.chainReceipt=receipt.receipt.transactionHash; state.deposit.status=receipt.success?'chain_confirmed':'chain_failed'; } }
    if(state.deposit?.txHash) { const receipt=await monadClient.getTransactionReceipt({hash:state.deposit.txHash}).catch(()=>null); if(receipt) { state.deposit.chainReceipt=receipt.transactionHash; state.deposit.status=receipt.status==='success'?'chain_confirmed':'chain_failed'; } }
    if(state.deposit?.quote) {
      const status=await routeStatus(state.deposit); state.deposit.routeStatus=status;
      if(status==='SUCCESS'&&state.phase==='funding'&&state.deposit.status==='chain_confirmed') {
        const c=await confidential(); let token;
        try {
          const balances=await privateBalance(c);
          token=selectPrivateBalance(balances,state.assets.private.assetId); state.creditBasis='authenticated_balance';
        } catch(error) {
          if(!authRejected(error)) throw error;
          const minimum=BigInt(state.deposit.quote.quote.minAmountOut);
          if(minimum<=0n||minimum>usdcAtoms) throw new Error('Route minimum output is outside the test cap');
          token={available:minimum.toString()}; state.creditBasis='route_success_minimum';
        }
        if(BigInt(token.available)>0n) { state.creditedAtoms=token.available; state.phase='credited'; }
      }
    }
    for(const p of state.payouts??[]) {
      p.routeStatus=await routeStatus(p);
      if(p.routeStatus==='SUCCESS'&&['signed','submitted'].includes(p.status)) {
        const {received,txHashes}=await destinationReceived(destinationChain,state.assets.destination,p.recipient,{fromBlock:p.fromBlock??p.ethFromBlock,fromBalance:p.fromBalance});
        if(received>=BigInt(p.quote.quote.minAmountOut)) { p.receivedAtoms=received.toString(); p.receiptTxHashes=txHashes; p.status='delivered'; }
      }
    }
    if(state.payouts?.length===3&&state.payouts.every(p=>p.status==='delivered')&&!state.postTransfer&&state.phase!=='swapping'&&state.phase!=='completed') state.phase='destinations_delivered'; await save(state); print(publicView(state)); return;
  }
  if(command==='swap-preview') {
    const index=swapIndex(arg,command); const state=await load(); await assertChains();
    const {context,balance,target}=await swapContext(state,index);
    const selected=await prepareSwapForBalance(context,{balance,target,slippageBps:swapSlippageBps});
    print({wallet:context.account.address,chainId:robinhoodChainId,target:state.target.symbol,router:selected.route.to,usdgBalance:formatUnits(balance,6),swapUSDG:formatUnits(selected.route.amountIn,6),maximumGasUSDG:formatUnits(selected.feeCapAtoms,6),quotedOut:formatUnits(selected.route.quotedOut,state.target.decimals),minimumOut:formatUnits(selected.route.minOut,state.target.decimals),nativeGasHeld:'0',submitted:false}); return;
  }
  if(command==='swap-send') {
    const index=swapIndex(arg,command); const state=await load(); await assertChains();
    const {context,balance,target}=await swapContext(state,index);
    const selected=await prepareSwapForBalance(context,{balance,target,slippageBps:swapSlippageBps});
    const beforeTarget=await hoodClient.readContract({address:target,abi:erc20Abi,functionName:'balanceOf',args:[context.account.address]});
    const signed=await signSwap(context,selected.prepared);
    state.swaps??=[null,null,null];
    state.swaps[index]={status:'signed',wallet:context.account.address,target,router:selected.route.to,paymaster:context.paymasterAddress,amountInAtoms:selected.route.amountIn.toString(),minOutAtoms:selected.route.minOut.toString(),quotedOutAtoms:selected.route.quotedOut.toString(),feeCapAtoms:selected.feeCapAtoms.toString(),beforeUsdgAtoms:balance.toString(),beforeTargetAtoms:beforeTarget.toString(),signed};
    state.phase='swapping'; await save(state);
    try { await submitSwap(signed); state.swaps[index].status='submitted'; await save(state); }
    catch { throw new Error(`Robinhood submission outcome unknown. Run swap-status ${index+1} before swap-resubmit ${index+1}.`); }
    print({swap:index+1,status:'submitted',userOperationHash:signed.userOperationHash,swapUSDG:formatUnits(selected.route.amountIn,6),maximumGasUSDG:formatUnits(selected.feeCapAtoms,6),minimumOut:formatUnits(selected.route.minOut,state.target.decimals)}); return;
  }
  if(command==='swap-status') {
    const index=swapIndex(arg,command); const state=await load(); const s=state.swaps?.[index]; if(!s?.signed) throw new Error(`No signed swap ${index+1}`);
    await assertChains(); const op=await swapReceipt(s.signed.userOperationHash);
    if(!op) { print({swap:index+1,status:s.status,userOperationHash:s.signed.userOperationHash,receipt:null}); return; }
    const receipt=await hoodClient.getTransactionReceipt({hash:op.receipt.transactionHash});
    if(!op.success||receipt.status!=='success') { s.status='failed'; s.txHash=receipt.transactionHash; await save(state); print({swap:index+1,status:'failed',txHash:s.txHash}); return; }
    const transfers=parseEventLogs({abi:[transferEvent],logs:receipt.logs,strict:false});
    const sum=list=>list.reduce((total,l)=>total+l.args.value,0n);
    const fromWallet=transfers.filter(l=>getAddress(l.address)===usdgContract&&getAddress(l.args.from)===getAddress(s.wallet));
    const gas=sum(fromWallet.filter(l=>getAddress(l.args.to)===getAddress(s.paymaster)));
    const swapped=sum(fromWallet)-gas;
    const received=sum(transfers.filter(l=>getAddress(l.address)===getAddress(s.target)&&getAddress(l.args.to)===getAddress(s.wallet)));
    const [afterUsdg,afterTarget]=await Promise.all([hoodClient.readContract({address:usdgContract,abi:erc20Abi,functionName:'balanceOf',args:[s.wallet]}),hoodClient.readContract({address:s.target,abi:erc20Abi,functionName:'balanceOf',args:[s.wallet]})]);
    if(swapped!==BigInt(s.amountInAtoms)||gas<=0n||gas>BigInt(s.feeCapAtoms)||received<BigInt(s.minOutAtoms)||afterUsdg!==BigInt(s.beforeUsdgAtoms)-swapped-gas||afterTarget-BigInt(s.beforeTargetAtoms)!==received) throw new Error('Swap receipts or balances do not reconcile; inspect the transaction before retrying');
    s.status='complete'; s.txHash=receipt.transactionHash; s.receivedAtoms=received.toString(); s.netGasAtoms=gas.toString(); s.afterUsdgAtoms=afterUsdg.toString();
    if(state.swaps.length===3&&state.swaps.every(x=>x?.status==='complete')) state.phase='completed';
    await save(state);
    print({swap:index+1,status:'complete',txHash:s.txHash,swapUSDG:formatUnits(swapped,6),gasUSDG:formatUnits(gas,6),received:`${formatUnits(received,state.target.decimals)} ${state.target.symbol}`,usdgRemainder:formatUnits(afterUsdg,6)}); return;
  }
  if(command==='swap-resubmit') {
    const index=swapIndex(arg,command); const state=await load(); const s=state.swaps?.[index];
    if(!s?.signed||!['signed','submitted'].includes(s.status)) throw new Error(`No unresolved signed swap ${index+1}`);
    const receipt=await swapReceipt(s.signed.userOperationHash);
    if(receipt) { print({swap:index+1,status:'receipt_found',txHash:receipt.receipt.transactionHash}); return; }
    await submitSwap(s.signed); s.status='submitted'; await save(state); print({swap:index+1,status:'submitted',userOperationHash:s.signed.userOperationHash,reusedSignedOperation:true}); return;
  }
  if(command==='fusion-preview') {
    const index=swapIndex(arg,command); const state=await load(); await assertChains();
    const {fusion,owner,balance,target}=await fusionContext(state,index);
    const quoted=await fusionQuote(fusion,{srcToken:usdgContract,dstToken:target.contract,amount:balance,preset:fusionPreset});
    const minOut=minimumOut(quoted.auctionEndAmount,fusionSlippageBps);
    const belowMarketBps=quoted.marketOut>0n&&quoted.auctionEndAmount<quoted.marketOut?(quoted.marketOut-quoted.auctionEndAmount)*10_000n/quoted.marketOut:0n;
    state.fusionPreviews??=[null,null,null];
    state.fusionPreviews[index]={at:new Date().toISOString(),wallet:owner.address,symbol:target.symbol,target:target.contract,preset:fusionPreset,amountInAtoms:balance.toString(),auctionStartAtoms:quoted.auctionStartAmount.toString(),auctionEndAtoms:quoted.auctionEndAmount.toString(),marketOutAtoms:quoted.marketOut.toString(),minOutAtoms:minOut.toString()};
    await save(state);
    const units=v=>`${formatUnits(v,target.decimals)} ${target.symbol}`;
    print({wallet:owner.address,chainId:robinhoodChainId,target:target.symbol,preset:fusionPreset,recommendedPreset:quoted.recommendedPreset,permitSpender:fusion.spender,settlement:quoted.settlement,
      swapUSDG:formatUnits(balance,6),marketOut:units(quoted.marketOut),auctionStart:units(quoted.auctionStartAmount),auctionEnd:units(quoted.auctionEndAmount),auctionEndBelowMarketBps:belowMarketBps,
      minimumOut:units(minOut),auctionSeconds:quoted.auctionDuration,partialFills:quoted.allowPartialFills,nativeGasHeld:'0',signed:false,previewValidFor:'10 minutes'}); return;
  }
  if(command==='fusion-send') {
    const index=swapIndex(arg,command); const state=await load(); await assertChains();
    const preview=state.fusionPreviews?.[index];
    if(!preview||Date.now()-Date.parse(preview.at)>fusionPreviewMaxAgeMs) throw new Error(`Run fusion-preview ${index+1} first; send uses a preview from the last 10 minutes`);
    const {fusion,owner,balance,target}=await fusionContext(state,index);
    if(preview.wallet!==owner.address||preview.target!==target.contract||preview.preset!==fusionPreset||BigInt(preview.amountInAtoms)!==balance) throw new Error(`Wallet, target, preset or USDG balance changed since fusion-preview ${index+1}`);
    const minOut=BigInt(preview.minOutAtoms);
    const deadline=BigInt(Math.floor(Date.now()/1000))+fusionPermitLifetime;
    const permit=await buildPermit({client:hoodClient,owner,token:usdgContract,spender:fusion.spender,amount:balance,deadline});
    const created=await fusionCreate(fusion,{srcToken:usdgContract,dstToken:target.contract,amount:balance,permit:permit.data,preset:fusionPreset});
    const checked=validateFusionOrder(fusionOrderSummary(created.order,permit.data),{maker:owner.address,srcToken:usdgContract,dstToken:target.contract,amount:balance,minOut,permit:permit.data});
    if(checked.deadline>=deadline) throw new Error('Fusion order outlives its permit; no order was signed');
    const [beforeTarget,fromBlock]=await Promise.all([hoodClient.readContract({address:target.contract,abi:erc20Abi,functionName:'balanceOf',args:[owner.address]}),hoodClient.getBlockNumber()]);
    const signed=await fusionSign(fusion,created);
    state.fusion??=[null,null,null];
    const history=state.fusion[index]?[...(state.fusion[index].history??[]),{status:state.fusion[index].status,orderHash:state.fusion[index].signed?.orderHash}]:[];
    state.fusion[index]={status:'signed',wallet:owner.address,symbol:target.symbol,target:target.contract,decimals:target.decimals,preset:fusionPreset,spender:fusion.spender,
      amountInAtoms:balance.toString(),minOutAtoms:checked.minOut.toString(),approvedMinOutAtoms:minOut.toString(),orderDeadline:checked.deadline.toString(),
      beforeUsdgAtoms:balance.toString(),beforeTargetAtoms:beforeTarget.toString(),fromBlock:fromBlock.toString(),permit:{data:permit.data,nonce:permit.nonce.toString(),deadline:deadline.toString()},signed,history};
    state.phase='swapping'; await save(state);
    try { await fusionSubmit(fusion,signed); state.fusion[index].status='submitted'; await save(state); }
    catch(error) { throw new Error(`Fusion submission outcome unknown (${error.message}). Run fusion-status ${index+1}; do not sign another order.`); }
    print({order:index+1,status:'submitted',orderHash:signed.orderHash,swapUSDG:formatUnits(balance,6),minimumOut:`${formatUnits(checked.minOut,target.decimals)} ${target.symbol}`,orderDeadline:new Date(Number(checked.deadline)*1000).toISOString()}); return;
  }
  if(command==='fusion-status') {
    const index=swapIndex(arg,command); const state=await load(); const s=state.fusion?.[index]; if(!s?.signed) throw new Error(`No signed Fusion order ${index+1}`);
    await assertChains();
    const fusion=await createFusion({owner:fusionOwner(state,index),client:hoodClient});
    let status;
    try { status=await fusionStatus(fusion,s.signed.orderHash); }
    catch(error) {
      if(error.status!==404) throw error;
      const expired=BigInt(Math.floor(Date.now()/1000))>BigInt(s.orderDeadline);
      if(expired) { s.status='not_accepted'; await save(state); }
      print({order:index+1,status:expired?'not_accepted':s.status,orderHash:s.signed.orderHash,relayerKnowsOrder:false}); return;
    }
    s.relayerStatus=status.status; s.fills=status.fills;
    if(status.status==='filled') {
      const r=await fusionReconcile(s,status);
      if(r.swapped!==BigInt(s.amountInAtoms)||r.received<BigInt(s.minOutAtoms)) throw new Error('Fusion fill is below the signed amounts; inspect the fill transactions');
      s.status='complete'; s.txHashes=r.txHashes; s.resolvers=r.resolvers; s.receivedAtoms=r.received.toString(); s.afterUsdgAtoms=r.afterUsdg.toString();
      if(state.fusion.filter(Boolean).length===3&&state.fusion.every(x=>x?.status==='complete')) state.phase='completed';
      await save(state);
      print({order:index+1,status:'complete',txHashes:s.txHashes,resolvers:s.resolvers,swapUSDG:formatUnits(r.swapped,6),received:`${formatUnits(r.received,s.decimals)} ${s.symbol}`,minimumOut:`${formatUnits(BigInt(s.minOutAtoms),s.decimals)} ${s.symbol}`,usdgRemainder:formatUnits(r.afterUsdg,6),walletEth:'0'}); return;
    }
    if(status.status==='partially-filled') { const r=await fusionReconcile(s,status); s.status='partially_filled'; s.txHashes=r.txHashes; s.receivedAtoms=r.received.toString(); }
    else if(status.status==='expired'||status.status==='cancelled') s.status=status.status;
    await save(state);
    print({order:index+1,status:s.status,relayerStatus:status.status,orderHash:s.signed.orderHash,fills:status.fills.length,orderDeadline:new Date(Number(s.orderDeadline)*1000).toISOString(),auctionStart:status.auctionStartDate?new Date(status.auctionStartDate*1000).toISOString():null,auctionSeconds:status.auctionDuration}); return;
  }
  if(command==='view') { print(publicView(await load())); return; }
  if(command==='recover-preview'||command==='recover-send'||command==='recover-status'||command==='recover-resubmit') {
    const f=source();
    if(await monadClient.getChainId()!==143) throw new Error('Monad RPC is not chain 143');
    const token=getAddress(process.env.MONAD_USDC_CONTRACT?.trim()||'0x754704bc059f8c67012fed69bc8a327a5aafb603');
    if(command==='recover-status'||command==='recover-resubmit') {
      if(!existsSync(recoverFile)) throw new Error('No saved recover operation');
      const rec=JSON.parse(await readFile(recoverFile,'utf8'));
      const receipt=await monadFundingReceipt(rec.signed.userOperationHash);
      if(command==='recover-status') {
        if(!receipt) { print({status:rec.status,userOperationHash:rec.signed.userOperationHash,receipt:null}); return; }
        rec.status=receipt.success?'complete':'failed'; rec.txHash=receipt.receipt.transactionHash; await writeFile(recoverFile,JSON.stringify(rec,null,2),{mode:0o600});
        print({status:rec.status,txHash:rec.txHash,to:rec.to,amountUSDC:formatUnits(BigInt(rec.amountAtoms),6),maximumGasUSDC:formatUnits(BigInt(rec.feeCapAtoms),6)}); return;
      }
      if(receipt) { print({status:'receipt_found',txHash:receipt.receipt.transactionHash}); return; }
      await submitMonadFunding(rec.signed); rec.status='submitted'; await writeFile(recoverFile,JSON.stringify(rec,null,2),{mode:0o600});
      print({status:'submitted',userOperationHash:rec.signed.userOperationHash,reusedSignedOperation:true}); return;
    }
    const to=getAddress(arg||need('RECOVER_ADD'));
    if(to===f.address) throw new Error('RECOVER_ADD must be a wallet you already control, not SOURCE');
    const balance=await monadClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    if(balance<=0n) throw new Error('SOURCE has no USDC to recover');
    const context=await createMonadPaymaster({chain:monad,client:monadClient,owner:f,token});
    const probe=await prepareMonadFunding(context,{token,recipient:to,amount:1n});
    const amount=fundingAmount(balance,probe.feeCapAtoms);
    const operation=await prepareMonadFunding(context,{token,recipient:to,amount});
    if(operation.feeCapAtoms>=balance) throw new Error('USDC paymaster fee consumes the recover balance');
    const sendAmount=fundingAmount(balance,operation.feeCapAtoms);
    if(sendAmount!==amount) {
      const again=await prepareMonadFunding(context,{token,recipient:to,amount:sendAmount});
      if(again.feeCapAtoms+sendAmount!==balance) throw new Error('Recover amount and gas fee did not match the SOURCE balance');
      operation.prepared=again.prepared; operation.feeCapAtoms=again.feeCapAtoms;
    }
    if(command==='recover-preview') {
      print({from:f.address,to,sourceUSDC:formatUnits(balance,6),recoverUSDC:formatUnits(sendAmount,6),maximumGasUSDC:formatUnits(operation.feeCapAtoms,6),nativeGasHeld:formatUnits(await monadClient.getBalance({address:f.address}),18),submitted:false}); return;
    }
    const signed=await signMonadFunding(context,operation.prepared);
    const rec={status:'signed',from:f.address,to,token,amountAtoms:sendAmount.toString(),feeCapAtoms:operation.feeCapAtoms.toString(),signed};
    await mkdir(secretDir,{recursive:true,mode:0o700}); await writeFile(recoverFile,JSON.stringify(rec,null,2),{mode:0o600});
    try { await submitMonadFunding(signed); rec.status='submitted'; await writeFile(recoverFile,JSON.stringify(rec,null,2),{mode:0o600}); }
    catch { throw new Error('Recover submission outcome unknown. Run recover-status before recover-resubmit.'); }
    print({status:'submitted',to,recoverUSDC:formatUnits(sendAmount,6),maximumGasUSDC:formatUnits(operation.feeCapAtoms,6),userOperationHash:signed.userOperationHash}); return;
  }
  throw new Error('Commands: check, init, tokens, assets, prepare, requote, fund, rebroadcast, balance, status, plan, replan, payout 1|2|3, resubmit 1|2|3, post-preview, post-send, post-status, post-resubmit, swap-preview 1|2|3, swap-send 1|2|3, swap-status 1|2|3, swap-resubmit 1|2|3, fusion-preview 1|2|3, fusion-send 1|2|3, fusion-status 1|2|3, recover-preview, recover-send, recover-status, recover-resubmit, view');
}
