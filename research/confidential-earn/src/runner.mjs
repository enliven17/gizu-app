import {createTestBudget,allocatedBudget} from './test-budget.mjs';
import {routeProfile,assertRouteState,assertNewRouteVaultReady} from './routes.mjs';
import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {privateKeyToAccount, generatePrivateKey} from 'viem/accounts';
import {createPublicClient, defineChain, erc20Abi, formatUnits, getAddress, http, parseAbiItem, parseEventLogs} from 'viem';
import {assertQuote, quoteDeadline, buildAuthPayload, encodeAuroraSignature, selectPrivateBalance, splitSourceBudget, chooseConfidentialAsset, validatePreparedIntent} from './core.mjs';
import {createMonadPaymaster, fundingAmount, monadFundingReceipt, prepareMonadFunding, signMonadFunding, sourceBudget, submitMonadFunding} from './source-paymaster.mjs';
import {circlePaymaster, createVaultContext, prepareVaultDeposit, resolveEthereumBundler, signVaultDeposit, submitVaultDeposit, vaultAddress, vaultDepositReceipt} from './vault-deposit.mjs';
import {assertBundlerFeeFloor, bidForRetry, bundlerMinimumFromError, bundlerVerificationFloorFromError, promoteWinningAttempt} from './ethereum-fee.mjs';
import {circleResidualBound,settledVaultStatus,refreshStoredResidualStatus} from './residual-policy.mjs';

const root = process.cwd();
const profile=process.env.EARN_ROUTE?routeProfile(process.env.EARN_ROUTE):null;
const destination=profile??routeProfile('ethereum');
const secretDir = join(root, profile?.directory??'.local');
const secretFile = join(secretDir, 'confidential-key');
const stateFile = join(secretDir, 'state.json');
const allocationFile=join(root,'.local','test-budget.json');
const usdcAtoms = 10_000_000n;
const sourceGasReserveAtoms = 10_000n;
const ethereumUsdc=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const confidentialContract='intents.far';
const monad = defineChain({id:143,name:'Monad Mainnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}}});
const ethereum = defineChain({id:1,name:'Ethereum Mainnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://ethereum-rpc.publicnode.com']}}});
const sourceRpc = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const ethRpc = process.env[destination.rpcEnv] || destination.rpc;
const monadClient = createPublicClient({chain:monad,transport:http(sourceRpc)});
const ethClient = createPublicClient({chain:destination.chain,transport:http(ethRpc)});

function need(name) { const value=process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name} in .env`); return value; }
function source() { const account=privateKeyToAccount(need('SOURCE_PK')); if (getAddress(need('SOURCE_ADD')) !== account.address) throw new Error('SOURCE_ADD does not match SOURCE_PK'); return account; }
function destinations() { const addresses=[1,2].map(i=>{ const address=getAddress(need(`DEST${i}_ADD`)); if(privateKeyToAccount(need(`DEST${i}_PK`)).address!==address) throw new Error(`DEST${i}_ADD does not match DEST${i}_PK`); return address; }); if(new Set(addresses).size!==2 || addresses.includes(getAddress(need('SOURCE_ADD')))) throw new Error('Source and two recipients must be distinct'); return addresses; }
async function confidential() { const key=(process.env.CONFIDENTIAL_PK?.trim() || (existsSync(secretFile) ? (await readFile(secretFile,'utf8')).trim() : null)); if (!key) throw new Error('Run init to create the confidential signer'); return privateKeyToAccount(key); }
async function save(value) { await mkdir(secretDir,{recursive:true,mode:0o700}); const tmp=`${stateFile}.${process.pid}.tmp`; await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600}); await chmod(tmp,0o600); await rename(tmp,stateFile); }
async function load() { if (!existsSync(stateFile)) throw new Error('Run prepare first'); const state=JSON.parse(await readFile(stateFile,'utf8')); if(profile)assertRouteState(state,profile); refreshStoredResidualStatus(state); return state; }
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
function selectToken(all,chain,contract,override,symbol='USDC') {
  const choices=all.filter(t=>t.blockchain===chain && t.symbol?.toUpperCase()===symbol && (!contract || t.contractAddress?.toLowerCase()===contract.toLowerCase()) && (!override || t.assetId===override));
  if(choices.length!==1) throw new Error(`Expected one ${chain} ${symbol} token; found ${choices.length}. Run tokens, then set the exact ${chain==='monad'?'MONAD':chain==='eth'?'ETHEREUM':chain==='hood'?'ROBINHOOD':'PRIVATE'}_ASSET_ID in .env.`);
  return choices[0];
}
async function assetSet() { const all=await tokens(); const source=selectToken(all,'monad',process.env.MONAD_USDC_CONTRACT,process.env.MONAD_ASSET_ID); return {
  source,
  private:chooseConfidentialAsset(all,source,process.env.PRIVATE_ASSET_ID),
  destination:selectToken(all,destination.blockchain,destination.token,profile?.id==='robinhood'?process.env.ROBINHOOD_ASSET_ID:process.env.ETHEREUM_ASSET_ID,destination.symbol),
}; }
async function assertChains() { if(await monadClient.getChainId()!==143) throw new Error('Monad RPC is not chain 143'); if(await ethClient.getChainId()!==destination.chain.id) throw new Error('Destination RPC chain differs from selected route'); }
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
  let amount=fundingAmount(budget,probe.feeCapAtoms,sourceGasReserveAtoms);
  for(let attempt=0;attempt<4;attempt++) {
    const request=quoteRequest({depositType:'ORIGIN_CHAIN',recipientType:'CONFIDENTIAL_INTENTS',recipient:c.address.toLowerCase(),refundType:'ORIGIN_CHAIN',refundTo:f.address,originAsset:assets.source.assetId,destinationAsset:assets.private.assetId,amount});
    const result=await quote(request);
    if(BigInt(result.quote.amountIn)!==amount) throw new Error('Aurora funding quote changed its source amount');
    const operation=await prepareMonadFunding(context,{token,recipient:result.quote.depositAddress,amount});
    if(operation.feeCapAtoms<=budget-amount) return {request,result,feeCapAtoms:operation.feeCapAtoms};
    amount=fundingAmount(budget,operation.feeCapAtoms,sourceGasReserveAtoms);
  }
  throw new Error('USDC paymaster fee did not stabilize; no source operation was signed');
}
async function routeStatus(entry) { if(!entry?.quote?.quote?.depositAddress) return null; const url=new URL(`https://intents-api.aurora.dev/api/status/${encodeURIComponent(need('AURORA_API_KEY'))}`); url.searchParams.set('depositAddress',entry.quote.quote.depositAddress); if(entry.quote.quote.depositMemo) url.searchParams.set('depositMemo',entry.quote.quote.depositMemo); const response=await fetch(url,{signal:AbortSignal.timeout(20000)}); if(!response.ok) throw new Error(`Aurora status failed: ${safeError(response)}`); return (await response.json()).status; }
function publicView(state) { return {phase:state.phase,source:state.source,confidential:state.confidential,creditBasis:state.creditBasis,creditedAtoms:state.creditedAtoms,deposit:{status:state.deposit?.status,routeStatus:state.deposit?.routeStatus,txHash:state.deposit?.txHash,userOperationHash:state.deposit?.signedUserOperation?.userOperationHash,route:state.deposit?.quote?.quote?.depositAddress},payouts:state.payouts?.map((p,i)=>({index:i+1,recipient:p.recipient,status:p.status,routeStatus:p.routeStatus,receivedAtoms:p.receivedAtoms,sourceAtoms:p.sourceAtoms,minDestinationAtoms:p.quote?.quote?.minAmountOut,intentHash:p.intentHash})),vaultDeposits:state.vaultDeposits?.map((p,i)=>p&&{index:i+1,status:p.status,amountAtoms:p.amountAtoms,feeCapAtoms:p.feeCapAtoms,sharesMinted:p.sharesMinted,userOperationHash:p.signed?.userOperationHash,txHash:p.txHash})}; }
export function archiveCompletedVaultDeposit(state,index,beforeShares) {
  const prior=state.vaultDeposits?.[index];
  if(!prior||!['complete','residual_exceeded'].includes(prior.status)) throw new Error('Previous vault deposit is unresolved');
  if(beforeShares!==0n) throw new Error('Previous vault shares remain; withdraw them before repeating the deposit');
  state.vaultDepositHistory??=[];
  state.vaultDepositHistory.push({wallet:index+1,...prior});
  state.vaultDeposits[index]=null;
}
async function earnContext(state,index,{allowExisting=false}={}) {
  if(index!==1) throw new Error('Only wallet 2 deposits into the vault');
  if(state.payouts?.length!==2||!state.payouts.every(p=>p.status==='delivered')) throw new Error('Two Ethereum payouts must be confirmed first');
  const prior=state.vaultDeposits?.[index];
  if(prior&&!allowExisting&&!['complete','residual_exceeded'].includes(prior.status)) throw new Error('Vault deposit already signed or submitted; run vault-status');
  const recipients=destinations();
  if(recipients.some((address,i)=>address!==getAddress(state.recipients[i]))) throw new Error('Destination addresses differ from the accepted plan');
  const owner=privateKeyToAccount(need(`DEST${index+1}_PK`));
  if(owner.address!==recipients[index]) throw new Error('Destination key does not match the recipient');
  const token=getAddress(state.assets.destination.contractAddress);
  if(token!==ethereumUsdc) throw new Error('Vault deposit requires canonical Ethereum USDC');
  const context=await createVaultContext({client:ethClient,chain:ethereum,owner,token,rpc:ethRpc});
  if(['complete','residual_exceeded'].includes(prior?.status)&&!allowExisting&&context.beforeShares!==0n) throw new Error('Previous vault shares remain; withdraw them before repeating the deposit');
  if(context.balance>BigInt(state.payouts[index].receivedAtoms??0)||context.balance>usdcAtoms) throw new Error('Destination has unaccounted USDC beyond its confirmed payout');
  return context;
}

export async function run(command,arg,detail) {
  if(profile&&command?.startsWith('vault-'))throw new Error('Use route deposit/withdraw/return commands; legacy Circle path is disabled for route profiles');
  if(profile?.id==='robinhood'&&command?.startsWith('native-'))throw new Error('Native Ethereum commands are unavailable on Robinhood');
  if(command?.startsWith('native-')) {const {runNative}=await import('./native-cli.mjs');return runNative(command,arg,detail,profile?{directory:secretDir}:{});}
  if(command==='check') { const f=source(); const d=destinations(); print({source:f.address,destinations:d,confidential:existsSync(secretFile)||!!process.env.CONFIDENTIAL_PK,auroraApiKeyConfigured:!!process.env.AURORA_API_KEY,pimlicoApiKeyConfigured:!!process.env.PIMLICO_API_KEY,destinationExecution:profile?.id==='ethereum'?'fusion-native':profile?.id==='robinhood'?'pimlico-usdg-paymaster':resolveEthereumBundler(process.env.ETHEREUM_BUNDLER||'pimlico').id,sourceBundler:'pimlico',sourceCapUSDC:'10',weights:'10/90',testAllocation:'70/30',route:profile?.id??'legacy',destinationChain:destination.chain.id,destinationToken:destination.symbol,vault:destination.vault}); return; }
  if(command==='init') { source(); destinations(); if(!process.env.CONFIDENTIAL_PK && !existsSync(secretFile)) { await mkdir(secretDir,{recursive:true,mode:0o700}); await writeFile(secretFile,generatePrivateKey(),{mode:0o600}); } const c=await confidential(); print({confidentialAccount:c.address,secretLocation:process.env.CONFIDENTIAL_PK?'CONFIDENTIAL_PK':secretFile}); return; }
  if(command==='tokens') { const all=await tokens(); print(all.filter(t=>['USDC',destination.symbol].includes(t.symbol?.toUpperCase()) && ['monad','near',destination.blockchain].includes(t.blockchain)).map(t=>({assetId:t.assetId,blockchain:t.blockchain,decimals:t.decimals,contractAddress:t.contractAddress}))); return; }
  if(command==='allocate') {
    if(!profile)throw new Error('Use a route profile for test allocation');
    if(existsSync(allocationFile)){const saved=JSON.parse(await readFile(allocationFile,'utf8'));const f=source();if(saved.source.toLowerCase()!==f.address.toLowerCase())throw new Error('Saved allocation source changed');print(saved);return;}
    for(const id of ['ethereum','robinhood'])if(existsSync(join(root,routeProfile(id).directory,'state.json')))throw new Error('Route state already exists; reconcile it before allocating new tests');
    const f=source();await assertChains();const assets=await assetSet(),token=getAddress(assets.source.contractAddress);
    const balance=await monadClient.readContract({address:token,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    const allocation=createTestBudget({balance,source:f.address,token,block:await monadClient.getBlockNumber()});
    await mkdir(join(root,'.local'),{recursive:true,mode:0o700});await writeFile(allocationFile,JSON.stringify(allocation,null,2)+'\n',{mode:0o600,flag:'wx'});print(allocation);return;
  }
  if(command==='prepare') {
    if(existsSync(stateFile)) throw new Error('State already exists; inspect it before starting a new run');
    const f=source(), c=await confidential(); destinations(); await assertChains(); const initialVaultShares=profile?await assertNewRouteVaultReady(profile,ethClient,destinations()[1],{allowExisting:profile.id==='ethereum'}):0n; const assets=await assetSet();
    if(assets.source.decimals!==6 || assets.private.decimals!==6 || assets.destination.decimals!==6) throw new Error('Unexpected USDC decimals');
    const contract=getAddress(assets.source.contractAddress);
    const chainDecimals=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'decimals'});
    const chainSymbol=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'symbol'});
    const balance=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    const nativeBalance=await monadClient.getBalance({address:f.address});
    const ethContract=getAddress(assets.destination.contractAddress);
    const ethDecimals=await ethClient.readContract({address:ethContract,abi:erc20Abi,functionName:'decimals'});
    const ethSymbol=await ethClient.readContract({address:ethContract,abi:erc20Abi,functionName:'symbol'});
    if(ethDecimals!==6 || ethSymbol!==destination.symbol) throw new Error('Destination token symbol/decimals mismatch');
    if(chainDecimals!==6 || chainSymbol!=='USDC') throw new Error('Source token must be verified six-decimal USDC');
    const budget=profile?allocatedBudget(JSON.parse(await readFile(allocationFile,'utf8').catch(e=>{if(e.code==='ENOENT')throw new Error('Run allocate once after recovering funds, before either test');throw e;})),{route:profile.id,source:f.address,token:contract,balance}):sourceBudget(balance);
    if(nativeBalance!==0n) throw new Error('Source holds MON; this run cannot prove the zero-MON paymaster path');
    const {request,result:funding,feeCapAtoms}=await fundingQuote(f,c,assets,budget);
    const recipients=destinations(); const estimates=[];
    const projected=splitSourceBudget(BigInt(funding.quote.amountOut));
    for(let i=0;i<2;i++) {
      const payoutRequest=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:c.address.toLowerCase(),originAsset:assets.private.assetId,destinationAsset:assets.destination.assetId,amount:projected[i]});
      let payoutQuote; try { payoutQuote=await quote(payoutRequest); } catch(error) { throw new Error(`Payout ${i+1} is unavailable for the projected private balance: ${error.message}. No source transaction was signed.`); }
      estimates.push({recipient:i+1,projectedSourceUSDC:formatUnits(projected[i],6),estimatedDestinationAmount:formatUnits(BigInt(payoutQuote.quote.amountOut),6),minimumDestinationAmount:formatUnits(BigInt(payoutQuote.quote.minAmountOut),6)});
    }
    const state={version:3,initialVaultShares:initialVaultShares.toString(),payoutWeights:'10/90',...(profile?{route:profile.id,chainId:profile.chain.id}:{}),phase:'prepared',createdAt:new Date().toISOString(),source:f.address,confidential:c.address.toLowerCase(),recipients,assets,deposit:{status:'quoted',request,quote:funding,budgetAtoms:budget.toString(),feeCapAtoms:feeCapAtoms.toString()},payouts:[],vaultDeposits:[null,null]}; await save(state);
    print({phase:'prepared',source:f.address,confidential:c.address,depositAddress:funding.quote.depositAddress,sourceBudgetUSDC:formatUnits(budget,6),sourceTransferUSDC:formatUnits(BigInt(funding.quote.amountIn),6),maximumMonadGasUSDC:formatUnits(feeCapAtoms,6),expectedPrivateUSDC:formatUnits(BigInt(funding.quote.amountOut),6),projectedPayouts:estimates,deadline:funding.quote.deadline}); return;
  }
  if(command==='requote') {
    const state=await load(); requirePhase(state,'prepared'); const f=source(),c=await confidential();
    if(f.address!==state.source||c.address.toLowerCase()!==state.confidential) throw new Error('Wallet changed');
    const budget=BigInt(state.deposit.budgetAtoms);
    if(budget<=0n||budget>usdcAtoms) throw new Error('Saved source budget is outside the 10 USDC cap');
    const {request,result,feeCapAtoms}=await fundingQuote(f,c,state.assets,budget);
    const projected=splitSourceBudget(BigInt(result.quote.amountOut));
    for(let i=0;i<2;i++) {
      const request=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:state.recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:state.confidential,originAsset:state.assets.private.assetId,destinationAsset:state.assets.destination.assetId,amount:projected[i]});
      try { await quote(request); } catch(error) { throw new Error(`Payout ${i+1} unavailable after requote: ${error.message}. No source transaction was signed.`); }
    }
    state.deposit.request=request; state.deposit.quote=result; state.deposit.feeCapAtoms=feeCapAtoms.toString(); await save(state); print({depositAddress:result.quote.depositAddress,sourceTransferUSDC:formatUnits(BigInt(result.quote.amountIn),6),maximumMonadGasUSDC:formatUnits(feeCapAtoms,6),deadline:result.quote.deadline,payoutsFeasible:true}); return;
  }
  if(command==='fund') {
    if(profile){for(const id of ['ethereum','robinhood']){if(id===profile.id)continue;const path=join(root,routeProfile(id).directory,'state.json');if(existsSync(path)){const other=JSON.parse(await readFile(path,'utf8'));if(other.phase==='funding')throw new Error('Other route has unresolved Monad funding; run its status first');}}}
    const state=await load(); requirePhase(state,'prepared'); const f=source(); if(f.address!==state.source) throw new Error('Source wallet changed'); await assertChains(); if(profile)await assertNewRouteVaultReady(profile,ethClient,state.recipients[1],{allowExisting:profile.id==='ethereum',expectedShares:BigInt(state.initialVaultShares??0)});
    const q=state.deposit.quote.quote; if(quoteDeadline(state.deposit.quote)<=Date.now()) throw new Error('Funding quote expired; no transaction signed');
    if(getAddress(q.depositAddress)===f.address) throw new Error('Funding quote points back to source');
    const contract=getAddress(state.assets.source.contractAddress);
    const amount=BigInt(q.amountIn);
    const budget=BigInt(state.deposit.budgetAtoms);
    const balance=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    if(budget<=0n||budget>usdcAtoms||balance<budget||amount<=0n) throw new Error('Source balance no longer covers the saved budget, or the budget exceeds 10 USDC');
    if(await monadClient.getBalance({address:f.address})!==0n) throw new Error('Source holds MON; zero-MON paymaster test stopped');
    const context=await createMonadPaymaster({chain:monad,client:monadClient,owner:f,token:contract});
    const operation=await prepareMonadFunding(context,{token:contract,recipient:q.depositAddress,amount});
    if(operation.feeCapAtoms>budget-amount) throw new Error('Monad USDC gas fee exceeds the saved source budget; run requote before funding');
    state.deposit.feeCapAtoms=operation.feeCapAtoms.toString();
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
    const portions=splitSourceBudget(available); const ethBlock=await ethClient.getBlockNumber(); const payouts=[];
    for(let i=0;i<2;i++) {
      const request=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:state.recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:state.confidential,originAsset:state.assets.private.assetId,destinationAsset:state.assets.destination.assetId,amount:portions[i]});
      const result=await quote(request); if(BigInt(result.quote.amountIn)>portions[i]) throw new Error(`Payout ${i+1} exceeds reserved source input`);
      if(i===0) {
        const generated=await api('generate-intent',{method:'POST',body:{type:'swap_transfer',standard:'erc191',signerId:state.confidential,depositAddress:result.quote.depositAddress}});
        const privateId=privateTokenIdFromIntent(generated.intent,state.assets.private.assetId);
        if(state.privateTokenId&&state.privateTokenId!==privateId) throw new Error('Private token changed across quotes');
        state.privateTokenId=privateId;
        validatePreparedIntent(generated.intent,{signerId:state.confidential,verifyingContract:confidentialContract,depositAddress:result.quote.depositAddress,tokenId:privateId,amount:portions[i],now:new Date()});
      }
      payouts.push({status:'quoted',recipient:state.recipients[i],sourceAtoms:portions[i].toString(),request,quote:result,ethFromBlock:ethBlock.toString()});
    }
    if(payouts.reduce((sum,p)=>sum+BigInt(p.sourceAtoms),0n)>available) throw new Error('Payouts exceed private balance');
    state.creditedAtoms=available.toString(); state.payouts=payouts; state.phase='planned'; await save(state);
    print({phase:'planned',creditBasis:state.creditBasis,availableUSDC:formatUnits(available,6),payouts:payouts.map((p,i)=>({recipient:i+1,sourceUSDC:formatUnits(BigInt(p.sourceAtoms),6),estimatedDestinationAmount:formatUnits(BigInt(p.quote.quote.amountOut),6),minimumDestinationAmount:formatUnits(BigInt(p.quote.quote.minAmountOut),6),deadline:p.quote.quote.deadline}))}); return;
  }
  if(command==='replan') { const state=await load(); requirePhase(state,'planned'); if(state.payouts.some(p=>p.signedData||p.intentHash)) throw new Error('Signed payout exists; reconcile before replanning'); state.payouts=[]; state.phase='credited'; await save(state); return run('plan'); }
  if(command==='payout') {
    const index=Number(arg)-1; if(!Number.isInteger(index)||index<0||index>1) throw new Error('Use payout 1 or 2');
    const state=await load(); if(state.phase!=='planned'&&state.phase!=='distributing') throw new Error('Plan and verify private credit before payout');
    const p=state.payouts[index]; if(!p||p.status!=='quoted') throw new Error('Payout already signed/submitted; run status');
    if(quoteDeadline(p.quote)<=Date.now()) throw new Error('Payout quote expired; no intent signed');
    for(let j=0;j<index;j++) if(state.payouts[j].status!=='delivered') throw new Error('Earlier payout unresolved');
    const c=await confidential(); if(c.address.toLowerCase()!==state.confidential) throw new Error('Confidential signer changed');
    const generated=await api('generate-intent',{method:'POST',body:{type:'swap_transfer',standard:'erc191',signerId:state.confidential,depositAddress:p.quote.quote.depositAddress}});
    validatePreparedIntent(generated.intent,{signerId:state.confidential,verifyingContract:confidentialContract,depositAddress:p.quote.quote.depositAddress,tokenId:state.privateTokenId,amount:BigInt(p.sourceAtoms),now:new Date()});
    const signedData={...generated.intent,signature:encodeAuroraSignature(await c.signMessage({message:generated.intent.payload}))};
    p.signedData=signedData; p.status='signed'; state.phase='distributing'; await save(state);
    try { const submitted=await api('submit-intent',{method:'POST',body:{type:'swap_transfer',signedData}}); if(!submitted.intentHash) throw new Error('No intent hash'); p.intentHash=submitted.intentHash; p.status='submitted'; await save(state); } catch { throw new Error('Submission outcome unknown. Signed intent saved; run status. Do not generate another intent.'); }
    print({recipient:index+1,status:p.status,intentHash:p.intentHash}); return;
  }
  if(command==='resubmit') {
    const index=Number(arg)-1; if(!Number.isInteger(index)||index<0||index>1) throw new Error('Use resubmit 1 or 2');
    const state=await load(); const p=state.payouts?.[index]; if(!p?.signedData||!['signed','submitted'].includes(p.status)) throw new Error('No unresolved saved intent');
    const route=await routeStatus(p); if(route!=='PENDING_DEPOSIT'&&route!=='INCOMPLETE_DEPOSIT') throw new Error(`Aurora route status ${route}; inspect before resubmission`);
    const submitted=await api('submit-intent',{method:'POST',body:{type:'swap_transfer',signedData:p.signedData}});
    if(!submitted.intentHash) throw new Error('Aurora returned no intent hash'); p.intentHash=submitted.intentHash; p.status='submitted'; await save(state); print({recipient:index+1,intentHash:p.intentHash,reusedSignedIntent:true}); return;
  }
  if(command==='vault-preview'||command==='vault-send') {
    const index=Number(arg)-1; if(index!==1) throw new Error('Use vault-preview 2 or vault-send 2');
    const state=await load(); await assertChains(); const context=await earnContext(state,index,{allowExisting:command==='vault-preview'&&state.vaultDeposits?.[index]?.status==='rejected_by_bundler'});
    const selected=await prepareVaultDeposit(context);
    if(command==='vault-preview') {
      print({wallet:index+1,owner:context.owner.address,chainId:1,vault:vaultAddress,token:context.token,paymaster:circlePaymaster,
        bundler:context.bundler.id,walletBalanceUSDC:formatUnits(context.balance,6),depositUSDC:formatUnits(selected.amount,6),maximumGasUSDC:formatUnits(selected.feeCap,6),residualBound:circleResidualBound({balance:context.balance,amount:selected.amount}),residualBoundScope:'Successful deposit with no intervening incoming USDC; relay admission remains separate',feeReferenceBlock:context.feeBlockNumber,maxFeePerGasWei:context.gasFees.maxFeePerGas,priorityFeePerGasWei:context.gasFees.maxPriorityFeePerGas,...(context.bundlerFeeFloor?{pimlicoSlowMaxFeeWei:context.bundlerFeeFloor.maxFeePerGas,pimlicoSlowPriorityWei:context.bundlerFeeFloor.maxPriorityFeePerGas,meetsPimlicoSlowQuote:context.gasFees.maxFeePerGas>=context.bundlerFeeFloor.maxFeePerGas&&context.gasFees.maxPriorityFeePerGas>=context.bundlerFeeFloor.maxPriorityFeePerGas}:{})}); return;
    }
    if(context.bundlerFeeFloor) assertBundlerFeeFloor(context.gasFees,context.bundlerFeeFloor);
    const signed=await signVaultDeposit(context,selected.prepared,{amount:selected.amount});
    state.vaultDeposits??=[null,null];
    if(state.vaultDeposits[index]) archiveCompletedVaultDeposit(state,index,context.beforeShares);
    state.vaultDeposits[index]={status:'signed',owner:context.owner.address,vault:vaultAddress,token:context.token,amountAtoms:selected.amount.toString(),feeCapAtoms:selected.feeCap.toString(),beforeBalanceAtoms:context.balance.toString(),beforeNativeAtoms:context.nativeBalance.toString(),beforeShares:context.beforeShares.toString(),feeBlockNumber:context.feeBlockNumber.toString(),signed};
    state.phase='vaults_pending'; await save(state);
    try { await submitVaultDeposit(signed); state.vaultDeposits[index].status='submitted'; await save(state); }
    catch(error) { const minimum=bundlerMinimumFromError(error); if(minimum!==null) { state.vaultDeposits[index].status='rejected_by_bundler'; state.vaultDeposits[index].bundlerMinimumMaxFeePerGas=minimum.toString(); await save(state); throw new Error(`Pimlico rejected the signed vault operation: minimum maximum fee ${minimum} wei. Run vault-status before retrying.`); } const verificationFloor=bundlerVerificationFloorFromError(error,selected.prepared.verificationGasLimit); if(verificationFloor!==null) { state.vaultDeposits[index].status='rejected_by_bundler'; state.vaultDeposits[index].bundlerMinimumVerificationGas=verificationFloor.toString(); await save(state); throw new Error(`${context.bundler.id} rejected the signed vault operation: verification gas needs at least ${verificationFloor}. Run vault-status before retrying.`); } throw new Error('Vault submission outcome unknown. Run vault-status before resubmitting the saved UserOperation.'); }
    print({wallet:index+1,status:'submitted',userOperationHash:signed.userOperationHash,depositUSDC:formatUnits(selected.amount,6),maximumGasUSDC:formatUnits(selected.feeCap,6)}); return;
  }
  if(command==='vault-status') {
    const index=Number(arg)-1; if(index!==1) throw new Error('Use vault-status 2');
    const state=await load(); const p=state.vaultDeposits?.[index]; if(!p?.signed) throw new Error('No signed vault deposit for this wallet');
    await assertChains(); let op,winning=p;
    const allAttempts=[...(p.attempts??[]),p];
    for(const attempt of allAttempts) { const found=await vaultDepositReceipt(attempt.signed.userOperationHash,attempt.signed.bundlerId); if(found) { if(op) throw new Error('Multiple vault attempts have receipts; inspect before reconciliation'); op=found; winning=attempt; } }
    if(!op) { print({wallet:index+1,status:p.status,userOperationHashes:[...(p.attempts??[]),p].map(attempt=>attempt.signed.userOperationHash),receipt:null}); return; }
    if(winning!==p) Object.assign(p,promoteWinningAttempt(p,winning));
    const receipt=await ethClient.getTransactionReceipt({hash:op.receipt.transactionHash});
    if(!op.success||receipt.status!=='success') { p.status='failed'; p.txHash=receipt.transactionHash; await save(state); print({wallet:index+1,status:'failed',txHash:p.txHash}); return; }
    const depositEvent=parseAbiItem('event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)');
    const sponsorEvent=parseAbiItem('event UserOperationSponsored(address indexed token, address indexed sender, bytes32 userOpHash, uint256 nativeTokenPrice, uint256 actualTokenNeeded, uint256 feeTokenAmount)');
    const deposits=parseEventLogs({abi:[depositEvent],logs:receipt.logs,strict:false}).filter(l=>getAddress(l.address)===getAddress(p.vault)&&getAddress(l.args.owner)===getAddress(p.owner)&&l.args.assets===BigInt(p.amountAtoms)&&l.args.shares>0n);
    const fees=parseEventLogs({abi:[sponsorEvent],logs:receipt.logs,strict:false}).filter(l=>getAddress(l.address)===circlePaymaster&&getAddress(l.args.sender)===getAddress(p.owner)&&getAddress(l.args.token)===getAddress(p.token)&&l.args.userOpHash.toLowerCase()===p.signed.userOperationHash.toLowerCase());
    const [afterBalance,afterShares,afterNative]=await Promise.all([ethClient.readContract({address:p.token,abi:erc20Abi,functionName:'balanceOf',args:[p.owner],blockNumber:receipt.blockNumber}),ethClient.readContract({address:p.vault,abi:erc20Abi,functionName:'balanceOf',args:[p.owner],blockNumber:receipt.blockNumber}),ethClient.getBalance({address:p.owner,blockNumber:receipt.blockNumber})]);
    const netGas=BigInt(p.beforeBalanceAtoms)-afterBalance-BigInt(p.amountAtoms);
    if(deposits.length!==1||fees.length!==1||netGas<0n||netGas>BigInt(p.feeCapAtoms)||netGas!==fees[0].args.actualTokenNeeded||afterShares-BigInt(p.beforeShares)<deposits[0].args.shares||p.beforeNativeAtoms!==undefined&&afterNative!==BigInt(p.beforeNativeAtoms)) throw new Error('Vault deposit event, shares, Circle charge or ETH balance do not reconcile; inspect the transaction before retrying');
    p.status=settledVaultStatus(afterBalance); p.txHash=receipt.transactionHash; p.netGasAtoms=netGas.toString(); p.sharesMinted=deposits[0].args.shares.toString(); p.afterBalanceAtoms=afterBalance.toString(); p.afterNativeAtoms=afterNative.toString(); p.afterShares=afterShares.toString();
    state.phase=p.status==='complete'?'completed':'residual_exceeded'; await save(state);
    print({wallet:index+1,status:p.status,transactionSucceeded:true,residualUSDC:formatUnits(afterBalance,6),optimalResidual:afterBalance<100_000n,txHash:p.txHash,depositUSDC:formatUnits(BigInt(p.amountAtoms),6),netGasUSDC:formatUnits(netGas,6),refundUSDC:formatUnits(BigInt(p.feeCapAtoms)-netGas,6),ethBalanceUnchanged:p.beforeNativeAtoms===undefined?undefined:afterNative===BigInt(p.beforeNativeAtoms),sharesMinted:p.sharesMinted}); return;
  }
  if(command==='vault-resubmit') {
    const index=Number(arg)-1; if(index!==1) throw new Error('Use vault-resubmit 2');
    const state=await load(); const p=state.vaultDeposits?.[index]; if(!p?.signed||!['signed','submitted'].includes(p.status)) throw new Error('No unresolved signed vault operation');
    for(const attempt of [...(p.attempts??[]),p]) { const receipt=await vaultDepositReceipt(attempt.signed.userOperationHash,attempt.signed.bundlerId); if(receipt) { print({wallet:index+1,status:'receipt_found',txHash:receipt.receipt.transactionHash}); return; } }
    if(p.feeBlockNumber!==undefined&&BigInt(p.feeBlockNumber)!==await ethClient.getBlockNumber()) throw new Error('Saved next-block bid is stale; run vault-reprice 2');
    await submitVaultDeposit(p.signed); p.status='submitted'; await save(state); print({wallet:index+1,status:'submitted',userOperationHash:p.signed.userOperationHash,reusedSignedOperation:true}); return;
  }
  if(command==='vault-reprice') {
    const index=Number(arg)-1; if(index!==1) throw new Error('Use vault-reprice 2');
    const state=await load(); const p=state.vaultDeposits?.[index]; if(!p?.signed||!['signed','submitted','rejected_by_bundler'].includes(p.status)) throw new Error('No unresolved signed vault operation');
    await assertChains();
    for(const attempt of [...(p.attempts??[]),p]) if(await vaultDepositReceipt(attempt.signed.userOperationHash,attempt.signed.bundlerId)) throw new Error('A vault attempt has a receipt; run vault-status 2');
    const context=await earnContext(state,index,{allowExisting:true});
    const old=p.signed.rpcOperation;
    const savedNonce=BigInt(old.nonce);
    if(await context.account.getNonce({key:savedNonce>>64n})!==savedNonce) throw new Error('Vault account nonce changed; run vault-status 2 before retrying');
    if(p.bundlerMinimumVerificationGas!==undefined) context.minimumVerificationGasLimit=BigInt(p.bundlerMinimumVerificationGas);
    context.gasFees=bidForRetry(context.gasFees,{maxFeePerGas:BigInt(old.maxFeePerGas),maxPriorityFeePerGas:BigInt(old.maxPriorityFeePerGas)},p.status);
    const selected=await prepareVaultDeposit(context,{nonce:savedNonce});
    if(context.bundlerFeeFloor) assertBundlerFeeFloor(context.gasFees,context.bundlerFeeFloor);
    if(BigInt(selected.prepared.nonce)!==savedNonce) throw new Error('Vault account nonce changed; run vault-status 2 before retrying');
    const signed=await signVaultDeposit(context,selected.prepared,{amount:selected.amount});
    const attempts=p.attempts??[];
    attempts.push({status:p.status,owner:p.owner,vault:p.vault,token:p.token,amountAtoms:p.amountAtoms,feeCapAtoms:p.feeCapAtoms,beforeBalanceAtoms:p.beforeBalanceAtoms,beforeNativeAtoms:p.beforeNativeAtoms,beforeShares:p.beforeShares,feeBlockNumber:p.feeBlockNumber,signed:p.signed});
    state.vaultDeposits[index]={status:'signed',owner:context.owner.address,vault:vaultAddress,token:context.token,amountAtoms:selected.amount.toString(),feeCapAtoms:selected.feeCap.toString(),beforeBalanceAtoms:context.balance.toString(),beforeNativeAtoms:context.nativeBalance.toString(),beforeShares:context.beforeShares.toString(),feeBlockNumber:context.feeBlockNumber.toString(),signed,attempts};
    await save(state);
    try { await submitVaultDeposit(signed); state.vaultDeposits[index].status='submitted'; await save(state); }
    catch(error) { const minimum=bundlerMinimumFromError(error); if(minimum!==null) { state.vaultDeposits[index].status='rejected_by_bundler'; state.vaultDeposits[index].bundlerMinimumMaxFeePerGas=minimum.toString(); await save(state); throw new Error(`Pimlico rejected the replacement: minimum maximum fee ${minimum} wei. Run vault-status before retrying.`); } const verificationFloor=bundlerVerificationFloorFromError(error,selected.prepared.verificationGasLimit); if(verificationFloor!==null) { state.vaultDeposits[index].status='rejected_by_bundler'; state.vaultDeposits[index].bundlerMinimumVerificationGas=verificationFloor.toString(); await save(state); throw new Error(`${context.bundler.id} rejected the replacement: verification gas needs at least ${verificationFloor}. Run vault-status before retrying.`); } throw new Error('Vault replacement submission outcome unknown. Run vault-status 2 before retrying.'); }
    print({wallet:index+1,status:'submitted',userOperationHash:signed.userOperationHash,maximumGasUSDC:formatUnits(selected.feeCap,6),replacedUserOperationHash:p.signed.userOperationHash}); return;
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
        const logs=await ethClient.getLogs({address:getAddress(state.assets.destination.contractAddress),event:parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),args:{to:p.recipient},fromBlock:BigInt(p.ethFromBlock)});
        const received=logs.reduce((sum,log)=>sum+(log.args.value??0n),0n);
        if(received>=BigInt(p.quote.quote.minAmountOut)) { p.receivedAtoms=received.toString(); p.receiptTxHashes=[...new Set(logs.map(l=>l.transactionHash))]; p.status='delivered'; }
      }
    }
    if(state.payouts?.length===2&&state.payouts.every(p=>p.status==='delivered')&&!state.vaultDeposits?.some(Boolean)) state.phase='destinations_delivered'; await save(state); print(publicView(state)); return;
  }
  if(command==='view') { print(publicView(await load())); return; }
  throw new Error('Commands: check, init, tokens, allocate, prepare, requote, fund, rebroadcast, balance, status, plan, replan, payout 1|2, resubmit 1|2, vault-preview 2, vault-send 2, vault-status 2, vault-resubmit 2, vault-reprice 2, view');
}
