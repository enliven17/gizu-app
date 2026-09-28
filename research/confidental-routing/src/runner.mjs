import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile, chmod} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {privateKeyToAccount, generatePrivateKey} from 'viem/accounts';
import {createPublicClient, defineChain, erc20Abi, formatUnits, getAddress, http, parseAbiItem, parseEventLogs} from 'viem';
import {assertQuote, buildAuthPayload, encodeAuroraSignature, selectPrivateBalance, splitSourceBudget, chooseConfidentialAsset, validatePreparedIntent} from './core.mjs';
import {createMonadPaymaster, fundingAmount, monadFundingReceipt, prepareMonadFunding, signMonadFunding, sourceBudget, submitMonadFunding} from './source-paymaster.mjs';
import {circlePaymaster, circleTransferReceipt, createCircleContext, prepareCircleTransfer, signCircleTransfer, submitCircleTransfer} from './circle-transfer.mjs';

const root = process.cwd();
const secretDir = join(root, '.local');
const secretFile = join(secretDir, 'confidential-key');
const stateFile = join(secretDir, 'state.json');
const usdcAtoms = 10_000_000n;
const ethereumUsdc=getAddress('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
const confidentialContract='intents.far';
const monad = defineChain({id:143,name:'Monad Mainnet',nativeCurrency:{name:'MON',symbol:'MON',decimals:18},rpcUrls:{default:{http:['https://rpc.monad.xyz']}}});
const ethereum = defineChain({id:1,name:'Ethereum Mainnet',nativeCurrency:{name:'Ether',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['https://ethereum-rpc.publicnode.com']}}});
const sourceRpc = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
const ethRpc = process.env.ETHEREUM_RPC_URL || 'https://ethereum-rpc.publicnode.com';
const monadClient = createPublicClient({chain:monad,transport:http(sourceRpc)});
const ethClient = createPublicClient({chain:ethereum,transport:http(ethRpc)});

function need(name) { const value=process.env[name]?.trim(); if (!value) throw new Error(`Missing ${name} in .env`); return value; }
function source() { const account=privateKeyToAccount(need('SOURCE_PK')); if (getAddress(need('SOURCE_ADD')) !== account.address) throw new Error('SOURCE_ADD does not match SOURCE_PK'); return account; }
function destinations() { const addresses=[1,2,3].map(i=>{ const address=getAddress(need(`DEST${i}_ADD`)); const key=process.env[`DEST${i}_PK`]?.trim(); if (key && privateKeyToAccount(key).address !== address) throw new Error(`DEST${i}_ADD does not match DEST${i}_PK`); return address; }); if(new Set(addresses).size!==3 || addresses.includes(getAddress(need('SOURCE_ADD')))) throw new Error('Source and three recipients must be distinct'); return addresses; }
async function confidential() { const key=(process.env.CONFIDENTIAL_PK?.trim() || (existsSync(secretFile) ? (await readFile(secretFile,'utf8')).trim() : null)); if (!key) throw new Error('Run init to create the confidential signer'); return privateKeyToAccount(key); }
async function save(value) { await mkdir(secretDir,{recursive:true,mode:0o700}); const tmp=`${stateFile}.${process.pid}.tmp`; await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600}); await chmod(tmp,0o600); await rename(tmp,stateFile); }
async function load() { if (!existsSync(stateFile)) throw new Error('Run prepare first'); return JSON.parse(await readFile(stateFile,'utf8')); }
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
async function assetSet() { const all=await tokens(); const source=selectToken(all,'monad',process.env.MONAD_USDC_CONTRACT,process.env.MONAD_ASSET_ID); return {
  source,
  private:chooseConfidentialAsset(all,source,process.env.PRIVATE_ASSET_ID),
  destination:selectToken(all,'eth',process.env.ETHEREUM_USDC_CONTRACT,process.env.ETHEREUM_ASSET_ID),
}; }
async function assertChains() { if(await monadClient.getChainId()!==143) throw new Error('Monad RPC is not chain 143'); if(await ethClient.getChainId()!==1) throw new Error('Ethereum RPC is not chain 1'); }
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
function publicView(state) { return {phase:state.phase,source:state.source,confidential:state.confidential,creditBasis:state.creditBasis,creditedAtoms:state.creditedAtoms,deposit:{status:state.deposit?.status,routeStatus:state.deposit?.routeStatus,txHash:state.deposit?.txHash,userOperationHash:state.deposit?.signedUserOperation?.userOperationHash,route:state.deposit?.quote?.quote?.depositAddress},payouts:state.payouts?.map((p,i)=>({index:i+1,recipient:p.recipient,status:p.status,routeStatus:p.routeStatus,receivedAtoms:p.receivedAtoms,sourceAtoms:p.sourceAtoms,minDestinationAtoms:p.quote?.quote?.minAmountOut,intentHash:p.intentHash})),postTransfer:state.postTransfer&&{status:state.postTransfer.status,amountAtoms:state.postTransfer.amountAtoms,feeCapAtoms:state.postTransfer.feeCapAtoms,userOperationHash:state.postTransfer.signed?.userOperationHash,txHash:state.postTransfer.txHash,netGasAtoms:state.postTransfer.netGasAtoms}}; }
async function postContext(state) {
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

export async function run(command,arg) {
  if(command==='check') { const f=source(); const d=destinations(); print({source:f.address,destinations:d,confidential:existsSync(secretFile)||!!process.env.CONFIDENTIAL_PK,auroraApiKeyConfigured:!!process.env.AURORA_API_KEY,pimlicoApiKeyConfigured:!!process.env.PIMLICO_API_KEY,sourceCapUSDC:'10',weights:'30/30/40'}); return; }
  if(command==='init') { source(); destinations(); if(!process.env.CONFIDENTIAL_PK && !existsSync(secretFile)) { await mkdir(secretDir,{recursive:true,mode:0o700}); await writeFile(secretFile,generatePrivateKey(),{mode:0o600}); } const c=await confidential(); print({confidentialAccount:c.address,secretLocation:process.env.CONFIDENTIAL_PK?'CONFIDENTIAL_PK':secretFile}); return; }
  if(command==='tokens') { const all=await tokens(); print(all.filter(t=>t.symbol?.toUpperCase()==='USDC' && ['monad','near','eth'].includes(t.blockchain)).map(t=>({assetId:t.assetId,blockchain:t.blockchain,decimals:t.decimals,contractAddress:t.contractAddress}))); return; }
  if(command==='prepare') {
    if(existsSync(stateFile)) throw new Error('State already exists; inspect it before starting a new run');
    const f=source(), c=await confidential(); destinations(); await assertChains(); const assets=await assetSet();
    if(assets.source.decimals!==6 || assets.private.decimals!==6 || assets.destination.decimals!==6) throw new Error('Unexpected USDC decimals');
    const contract=getAddress(assets.source.contractAddress);
    const chainDecimals=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'decimals'});
    const chainSymbol=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'symbol'});
    const balance=await monadClient.readContract({address:contract,abi:erc20Abi,functionName:'balanceOf',args:[f.address]});
    const nativeBalance=await monadClient.getBalance({address:f.address});
    const ethContract=getAddress(assets.destination.contractAddress);
    const ethDecimals=await ethClient.readContract({address:ethContract,abi:erc20Abi,functionName:'decimals'});
    const ethSymbol=await ethClient.readContract({address:ethContract,abi:erc20Abi,functionName:'symbol'});
    if(ethDecimals!==6 || ethSymbol!=='USDC') throw new Error('Destination token is not 6-decimal USDC');
    if(chainDecimals!==6 || chainSymbol!=='USDC') throw new Error('Source token must be verified six-decimal USDC');
    const budget=sourceBudget(balance);
    if(nativeBalance!==0n) throw new Error('Source holds MON; this run cannot prove the zero-MON paymaster path');
    const {request,result:funding,feeCapAtoms}=await fundingQuote(f,c,assets,budget);
    const recipients=destinations(); const estimates=[];
    const projected=splitSourceBudget(BigInt(funding.quote.amountOut));
    for(let i=0;i<3;i++) {
      const payoutRequest=quoteRequest({depositType:'CONFIDENTIAL_INTENTS',recipientType:'DESTINATION_CHAIN',recipient:recipients[i],refundType:'CONFIDENTIAL_INTENTS',refundTo:c.address.toLowerCase(),originAsset:assets.private.assetId,destinationAsset:assets.destination.assetId,amount:projected[i]});
      let payoutQuote; try { payoutQuote=await quote(payoutRequest); } catch(error) { throw new Error(`Payout ${i+1} is unavailable for the projected private balance: ${error.message}. No source transaction was signed.`); }
      estimates.push({recipient:i+1,projectedSourceUSDC:formatUnits(projected[i],6),estimatedEthereumUSDC:formatUnits(BigInt(payoutQuote.quote.amountOut),6),minimumEthereumUSDC:formatUnits(BigInt(payoutQuote.quote.minAmountOut),6)});
    }
    const state={version:2,phase:'prepared',createdAt:new Date().toISOString(),source:f.address,confidential:c.address.toLowerCase(),recipients,assets,deposit:{status:'quoted',request,quote:funding,budgetAtoms:budget.toString(),feeCapAtoms:feeCapAtoms.toString()},payouts:[]}; await save(state);
    print({phase:'prepared',source:f.address,confidential:c.address,depositAddress:funding.quote.depositAddress,sourceBudgetUSDC:formatUnits(budget,6),sourceTransferUSDC:formatUnits(BigInt(funding.quote.amountIn),6),maximumMonadGasUSDC:formatUnits(feeCapAtoms,6),expectedPrivateUSDC:formatUnits(BigInt(funding.quote.amountOut),6),projectedPayouts:estimates,deadline:funding.quote.deadline}); return;
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
      const privateBalance=selectPrivateBalance(balances,state.assets.private.assetId);
      available=BigInt(privateBalance.available); state.creditBasis='authenticated_balance';
    } catch(error) { if(!authRejected(error)) throw error; if(state.creditBasis!=='route_success_minimum') throw new Error('No authenticated or route-confirmed private balance'); }
    if(available<=0n || available>usdcAtoms) throw new Error('Private available amount outside test cap');
    const portions=splitSourceBudget(available); const ethBlock=await ethClient.getBlockNumber(); const payouts=[];
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
      payouts.push({status:'quoted',recipient:state.recipients[i],sourceAtoms:portions[i].toString(),request,quote:result,ethFromBlock:ethBlock.toString()});
    }
    if(payouts.reduce((sum,p)=>sum+BigInt(p.sourceAtoms),0n)>available) throw new Error('Payouts exceed private balance');
    state.creditedAtoms=available.toString(); state.payouts=payouts; state.phase='planned'; await save(state);
    print({phase:'planned',creditBasis:state.creditBasis,availableUSDC:formatUnits(available,6),payouts:payouts.map((p,i)=>({recipient:i+1,sourceUSDC:formatUnits(BigInt(p.sourceAtoms),6),estimatedEthereumUSDC:formatUnits(BigInt(p.quote.quote.amountOut),6),minimumEthereumUSDC:formatUnits(BigInt(p.quote.quote.minAmountOut),6),deadline:p.quote.quote.deadline}))}); return;
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
        const logs=await ethClient.getLogs({address:getAddress(state.assets.destination.contractAddress),event:parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),args:{to:p.recipient},fromBlock:BigInt(p.ethFromBlock)});
        const received=logs.reduce((sum,log)=>sum+(log.args.value??0n),0n);
        if(received>=BigInt(p.quote.quote.minAmountOut)) { p.receivedAtoms=received.toString(); p.receiptTxHashes=[...new Set(logs.map(l=>l.transactionHash))]; p.status='delivered'; }
      }
    }
    if(state.payouts?.length===3&&state.payouts.every(p=>p.status==='delivered')&&!state.postTransfer) state.phase='destinations_delivered'; await save(state); print(publicView(state)); return;
  }
  if(command==='view') { print(publicView(await load())); return; }
  throw new Error('Commands: check, init, tokens, prepare, requote, fund, rebroadcast, balance, status, plan, replan, payout 1|2|3, resubmit 1|2|3, post-preview, post-send, post-status, post-resubmit, view');
}
