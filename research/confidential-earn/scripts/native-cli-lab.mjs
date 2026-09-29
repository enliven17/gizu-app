// Integration test: real CLI/planner/journal, deployed contracts, local provider
// write mocks. No public transaction or signed order can leave this process.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicClient,http,toHex,encodeFunctionData,erc20Abi,getAddress,parseAbi} from 'viem';
import {mainnet} from 'viem/chains';
import {Address,Extension,FusionOrder,LimitOrderContract,TakerTraits,AmountMode} from '@1inch/fusion-sdk';
import {runNative} from '../src/native-cli.mjs';
import {createNativeContext} from '../src/native-context.mjs';
import {fusionSpender,weth} from '../src/fusion-bootstrap.mjs';
import {usdc,tokenBalance,vault} from '../src/native-vault.mjs';
import {json} from '../src/native-runtime.mjs';
const rpc='http://127.0.0.1:18564';
const client=createPublicClient({chain:mainnet,transport:http(rpc,{timeout:120000,retryCount:0}),cacheTime:0});
assert.match(await client.request({method:'web3_clientVersion'}),/anvil/i);assert.equal(await client.getChainId(),1);assert.equal(await client.getBlockNumber(),26079549n);
const snapshot=await client.request({method:'evm_snapshot'});
const root=await mkdtemp(join(tmpdir(),'native-cli-lab-'));await mkdir(join(root,'.local'),{mode:0o700});
await writeFile(join(root,'.local/state.json'),await readFile(new URL('../.local/state.json',import.meta.url)),{mode:0o600});
const env={...process.env,ETHEREUM_RPC_URL:rpc,ANVIL_PATH:process.env.ANVIL_PATH||'/private/tmp/anvil'};
const owner=getAddress(env.DEST2_ADD),other=getAddress(env.DEST1_ADD);
const fetchOriginal=globalThis.fetch;
const orders=new Map(),resolverByQuote=new Map();let quoteNumber=0,signingQuotes=0,submissions=0,routeSuccess=false;
const evidence=[];
async function receipt(hash){for(let i=0;i<200;i++){const r=await client.getTransactionReceipt({hash}).catch(()=>null);if(r){assert.equal(r.status,'success');return r;}await new Promise(r=>setTimeout(r,50));}throw new Error('Local receipt missing');}
async function sendAs(from,to,data,value=0n){const b=await client.getBlock();const fee=b.baseFeePerGas*2n+1000000000n;return receipt(await client.request({method:'eth_sendTransaction',params:[{from,to,data,value:toHex(value),gas:'0x1e8480',maxFeePerGas:toHex(fee),maxPriorityFeePerGas:'0x0'}]}));}
async function fill(payload){
 const order=FusionOrder.fromDataAndExtension(payload.order,Extension.decode(payload.extension));
 const resolver=getAddress(resolverByQuote.get(payload.quoteId));assert(resolver);
 await client.request({method:'anvil_impersonateAccount',params:[resolver]});await client.request({method:'anvil_setBalance',params:[resolver,toHex(10n**20n)]});
 const amount=order.makingAmount,gross=order.calcTakingAmount(new Address(resolver),amount,order.auctionEndTime,0n);
 await sendAs(resolver,weth,'0xd0e30db0',gross);await sendAs(resolver,weth,encodeFunctionData({abi:erc20Abi,functionName:'approve',args:[fusionSpender,gross]}));
 const now=(await client.getBlock()).timestamp;const time=now>=order.auctionEndTime?now+1n:order.auctionEndTime;assert(time<order.deadline);
 await client.request({method:'evm_setNextBlockTimestamp',params:[Number(time)]});await client.request({method:'evm_mine'});
 const taker=TakerTraits.default().setAmountMode(AmountMode.maker).setExtension(order.extension).setAmountThreshold(gross);
 const data=LimitOrderContract.getFillOrderArgsCalldata(order.build(),payload.signature,taker,amount);
 const r=await sendAs(resolver,fusionSpender,data);await client.request({method:'evm_mine'});
 orders.set(order.getOrderHash(1),{status:'filled',fills:[{txHash:r.transactionHash,filledMakerAmount:String(amount),filledAuctionTakerAmount:String(gross)}]});
}
globalThis.fetch=async(input,options)=>{
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 if(url.hostname==='api.1inch.com') {
  if(url.pathname.includes('/quoter/')) {
   const estimated=url.searchParams.get('enableEstimate')==='true';if(estimated)signingQuotes++;
   // Ask the real service only for UNSIGNED read-only terms; a test ID permits
   // exercising submission locally. Never send the signed permit externally.
   url.searchParams.set('enableEstimate','false');url.searchParams.delete('permit');
   await new Promise(r=>setTimeout(r,1200));
   const r=await fetchOriginal(url,options);const body=await r.json();if(!r.ok)return Response.json(body,{status:r.status});
   if(estimated){body.quoteId=`local-test-${++quoteNumber}`;resolverByQuote.set(body.quoteId,body.whitelist[0]);}
   return Response.json(body);
  }
  if(url.pathname.includes('/relayer/')){submissions++;await fill(JSON.parse(options.body));return new Response(null,{status:200});}
  if(url.pathname.includes('/order/status/'))return orders.has(url.pathname.split('/').at(-1))?Response.json(orders.get(url.pathname.split('/').at(-1))):new Response(null,{status:404});
  throw new Error('Unexpected Fusion endpoint in local test');
 }
 if(url.hostname==='intents-api.aurora.dev'&&url.pathname.includes('/status/'))return Response.json({status:routeSuccess?'SUCCESS':'PROCESSING'});
 if(url.hostname==='intents-api.aurora.dev')return fetchOriginal(input,options); // Unfunded quotes and registry only.
 if(url.hostname!=='127.0.0.1')throw new Error('Nonlocal execution endpoint rejected by test transport');
 return fetchOriginal(input,options);
};
const factory=async args=>{const c=await createNativeContext(args);const sign=c.signTransaction;c.signTransaction=async req=>{assert.equal(req.chainId,1);assert(!json(req).toLowerCase().includes(other.slice(2).toLowerCase()));return sign(req);};return c;};
async function command(name,detail){const result=await runNative(name,'2',detail,{root,env,contextFactory:factory,print:view=>evidence.push({command:name,...view})});await client.request({method:'evm_mine'});return result;}
try {
 const donor=getAddress('0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8');await client.request({method:'anvil_impersonateAccount',params:[donor]});await client.request({method:'anvil_setBalance',params:[donor,toHex(10n**18n)]});
 await sendAs(donor,usdc,encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[owner,25000000n-await tokenBalance(client,usdc,owner)]}));await client.request({method:'anvil_setBalance',params:[owner,'0x0']});
 const otherBefore={usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)};
 await command('native-preview','deposit');assert.equal(signingQuotes,0);assert.equal(submissions,0);
 let s;
 for(let i=0;i<8;i++){s=await command('native-deposit');console.log(json({command:'deposit',phase:s.phase,pending:s.pending?.type}));if(s.phase==='invested')break;}
 assert.equal(s.phase,'invested');assert.equal((await tokenBalance(client,usdc,owner)),50000n);
 for(let i=0;i<6;i++){s=await command('native-withdraw');console.log(json({command:'withdraw',phase:s.phase,pending:s.pending?.type}));if(s.phase==='withdrawn')break;}
 assert.equal(s.phase,'withdrawn');
 for(let i=0;i<8;i++){s=await command('native-return');console.log(json({command:'return',phase:s.phase,pending:s.pending?.type}));if(s.phase==='awaiting_aurora')break;}
 assert.equal(s.phase,'awaiting_aurora');assert.equal(s.balances.eth,0n);assert.equal(s.balances.usdc,0n);assert.equal(s.balances.shares,0n);
 s=await command('native-status');assert.equal(s.phase,'awaiting_aurora');
 routeSuccess=true;s=await command('native-status');assert.equal(s.phase,'complete');
 assert.deepEqual({usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)},otherBefore);
 await writeFile(new URL('../fixtures/native-cli-integration.json',import.meta.url),json({scope:'Real CLI/journal/simulator on fork. Fusion submit/status and Aurora status are local mocks; live quotes unsigned/unfunded only. SUCCESS transitions are mocked, not real credit.',signingQuotes,submissions,final:s.balances,phase:s.phase,evidence})+'\n');
 console.log('CLI local integration passed; mocked provider success, zero ETH/USDC/shares.');
} finally {globalThis.fetch=fetchOriginal;await client.request({method:'anvil_dropAllTransactions'});await client.request({method:'evm_revert',params:[snapshot]});await rm(root,{recursive:true,force:true});}
