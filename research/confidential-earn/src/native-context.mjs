import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createPublicClient,http,erc20Abi,getAddress,keccak256,parseAbi,parseAbiItem,parseEventLogs} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {mainnet} from 'viem/chains';
import {tokenBalance,usdc,vault} from './native-vault.mjs';
import {fusionSpender,weth,quoteNativeEth} from './fusion-bootstrap.mjs';
import {marketFees,prepareNativeStep,assertNativeMarket} from './native-planner.mjs';
import {simulateNative} from './native-simulation.mjs';
import {prepareFusion,submitFusion,fusionStatus,auroraStatus} from './native-providers.mjs';
import {quoteAuroraReturn} from './aurora-return.mjs';
import {json} from './native-runtime.mjs';
import {assertBootstrapSettlement} from './native-gas.mjs';
import {readTokenPrices} from './token-prices.mjs';
const transferEvent=parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
const orderEvent=parseAbiItem('event OrderFilled(bytes32 orderHash,uint256 remainingAmount)');
const vaultEvents=parseAbi(['event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)','event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)']);
const lower=a=>a.toLowerCase();
const need=(env,name)=>{if(!env[name]?.trim())throw new Error(`Missing ${name}`);return env[name].trim();};
export async function createNativeContext({root,directory=join(root,'.local'),env=process.env,save}) {
 const owner=getAddress(need(env,'DEST2_ADD')),other=getAddress(need(env,'DEST1_ADD'));
 if(owner===other||lower(owner)===lower(need(env,'SOURCE_ADD')))throw new Error('Source and destination wallets must be distinct');
 const source=JSON.parse(await readFile(join(directory,'state.json'),'utf8'));
 if(env.EARN_ROUTE&& (source.route!=='ethereum'||source.chainId!==1||!source.payouts?.every(p=>p.status==='delivered')||source.payouts.length!==2))throw new Error('Confirm both Ethereum route payouts before native earn');
 if(lower(source.recipients?.[1]??'')!==lower(owner)||lower(source.recipients?.[0]??'')!==lower(other))throw new Error('Routing state recipients differ from configured wallets');
 if(!/^0x[0-9a-fA-F]{40}$/.test(source.confidential??''))throw new Error('Missing confidential return account in routing state');
 if(lower(source.assets?.destination?.contractAddress??'')!==lower(usdc)||source.assets?.private?.decimals!==6)throw new Error('Routing state has unexpected USDC assets');
 const rpcUrl=env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com';
 const client=createPublicClient({chain:mainnet,transport:http(rpcUrl,{timeout:30000,retryCount:1}),cacheTime:0});
 if(await client.getChainId()!==1)throw new Error('Native earn requires Ethereum chain 1');
 const asset=await client.readContract({address:vault,abi:parseAbi(['function asset() view returns(address)']),functionName:'asset'});
 if(lower(asset)!==lower(usdc))throw new Error('Vault underlying asset differs from Ethereum USDC');
 const bindings={owner,other,confidential:source.confidential,originAsset:source.assets.destination.assetId,destinationAsset:source.assets.private.assetId,vault,usdc,chainId:1};
 const signer=()=>{const account=privateKeyToAccount(need(env,'DEST2_PK'));if(account.address!==owner)throw new Error('DEST2_PK does not match DEST2_ADD');return account;};
 let cachedPrice;
 const c={client,owner,bindings,save,initialShares:env.EARN_ROUTE==='ethereum'?BigInt(source.initialVaultShares??0):0n,
  balances:async()=>({usdc:await tokenBalance(client,usdc,owner),eth:await client.getBalance({address:owner}),shares:await tokenBalance(client,vault,owner),weth:await tokenBalance(client,weth,owner)}),
  latestNonce:()=>client.getTransactionCount({address:owner,blockTag:'latest'}),
  pendingNonce:()=>client.getTransactionCount({address:owner,blockTag:'pending'}),
  fees:options=>marketFees(client,options),
  async price(){
   if(cachedPrice)return cachedPrice;
   [cachedPrice]=await readTokenPrices({apiKey:need(env,'AURORA_API_KEY'),assetIds:['nep141:eth.omft.near']});return cachedPrice;
  },
  simulate:options=>simulateNative({rpcUrl,anvilPath:env.ANVIL_PATH||'anvil',owner,...options}),
  quoteFusion:(input,{fees})=>quoteNativeEth({owner,input,resolverGasPrice:fees.depositFee,apiKey:need(env,'ONEINCH_API_KEY')}),
  prepareFusion:async funding=>{
   await c.assertFresh(funding.fees,funding.before);
   if(await c.latestNonce()!==await c.pendingNonce())throw new Error('Resolve pending wallet transactions before a Fusion order');
   const prepared=await prepareFusion({client,owner:signer(),...funding,apiKey:need(env,'ONEINCH_API_KEY')});
   await c.assertFresh(funding.fees,funding.before);
   return prepared;
  },
  submitFusion:payload=>submitFusion({payload,apiKey:need(env,'ONEINCH_API_KEY')}),
  quoteReturn:(kind,amount)=>quoteAuroraReturn({apiKey:need(env,'AURORA_API_KEY'),owner,confidential:bindings.confidential,originAsset:kind==='eth'?'nep141:eth.omft.near':bindings.originAsset,destinationAsset:bindings.destinationAsset,amount}),
  auroraStatus:route=>auroraStatus({apiKey:need(env,'AURORA_API_KEY'),route}),
  async validateRecipient(address,native){
   if([owner,other,getAddress(need(env,'SOURCE_ADD'))].includes(getAddress(address)))throw new Error('Return quote points to a source/destination wallet');
   if(native&&(await client.getCode({address})??'0x')!=='0x')throw new Error('Native return recipient must have no code');
  },
  async assertFresh(fees,before){
   const block=await client.getBlock();
   if(block.number>fees.block.number+1n)throw new Error('Native plan is stale; run the command again for a fresh plan');
   if((await client.getBlock({blockNumber:fees.block.number})).hash!==fees.block.hash)throw new Error('Native reference block reorganized; re-plan');
   assertNativeMarket(fees,block);
   assert.deepEqual(await c.balances(),before,'Wallet balances changed during planning');
  },
  async signTransaction(request){const raw=await signer().signTransaction(request);return {raw,hash:keccak256(raw)};},
  broadcast:raw=>client.sendRawTransaction({serializedTransaction:raw}),
  async receipt(hash){try{return await client.getTransactionReceipt({hash});}catch(e){if(e.name==='TransactionReceiptNotFoundError')return null;throw e;}},
  confirmed:async receipt=>(await client.getBlockNumber())>=receipt.blockNumber+1n,
  async canRebroadcast(attempt){
   const wall=BigInt(Math.floor(Date.now()/1000)),chain=(await client.getBlock()).timestamp,now=wall>chain?wall:chain;
   if(attempt.route)return now+30n<attempt.route.deadline;
   if(['deposit','withdraw'].includes(attempt.kind))return now+30n<attempt.fees.block.timestamp+600n;
   return true;
  },
  async verifyTransaction(attempt,receipt){
   const transaction=await client.getTransaction({hash:attempt.hash});
   if(lower(transaction.from)!==lower(owner)||lower(transaction.to??'')!==lower(attempt.request.to)||transaction.nonce!==attempt.nonce||transaction.input!==(attempt.request.data??'0x')||transaction.value!==(attempt.request.value??0n))throw new Error('Mined transaction differs from saved native request');
   if(json(receipt.logs).toLowerCase().includes(other.slice(2).toLowerCase()))throw new Error('Unexpected other-wallet reference in receipt');
   const transfer=parseEventLogs({abi:[transferEvent],logs:receipt.logs,strict:false}).filter(e=>lower(e.address)===lower(usdc));
   const events=parseEventLogs({abi:vaultEvents,logs:receipt.logs,strict:false}).filter(e=>lower(e.address)===lower(vault));
   if(attempt.kind==='deposit'&&!events.some(e=>e.eventName==='Deposit'&&lower(e.args.owner)===lower(owner)&&e.args.assets===attempt.details.amount&&e.args.shares>0n))throw new Error('Vault deposit ownership/amount not proven by receipt');
   if(attempt.kind==='withdraw'&&!events.some(e=>e.eventName==='Withdraw'&&lower(e.args.owner)===lower(owner)&&e.args.shares===attempt.details.shares))throw new Error('Vault redemption not proven by receipt');
   if(attempt.kind==='return_usdc'&&!transfer.some(e=>lower(e.args.from)===lower(owner)&&lower(e.args.to)===lower(attempt.route.recipient)&&e.args.value===attempt.before.usdc))throw new Error('Aurora USDC transfer not proven by receipt');
   if(attempt.kind==='return_eth'&&(receipt.gasUsed!==21000n||receipt.effectiveGasPrice!==attempt.request.gasPrice))throw new Error('Native sweep gas differed from the exact plan');
   const after=await c.balances();
   const spent=receipt.gasUsed*receipt.effectiveGasPrice+(attempt.request.value??0n);
   if(attempt.before.eth-after.eth!==spent)throw new Error('Native ETH balance does not reconcile with confirmed gas/value');
   if(attempt.kind==='deposit'&&after.usdc!==50000n)throw new Error('Deposit USDC residual differs from 0.05');
   if(attempt.kind==='deposit'){
    const minted=events.filter(e=>e.eventName==='Deposit'&&lower(e.args.owner)===lower(owner)).reduce((sum,e)=>sum+e.args.shares,0n);
    if(after.shares!==attempt.before.shares+minted)throw new Error('Existing plus newly minted shares do not reconcile');
   }
   if(attempt.kind==='withdraw'){
    const event=events.find(e=>e.eventName==='Withdraw'&&lower(e.args.owner)===lower(owner));
    if(after.shares!==0n||after.usdc-attempt.before.usdc!==event.args.assets)throw new Error('Redemption assets/shares do not reconcile to the owner');
   }
   if(attempt.kind==='return_usdc'&&after.usdc!==0n)throw new Error('USDC remains after return');
   if(attempt.kind==='return_eth'&&(after.eth!==0n||after.usdc!==0n||after.shares!==0n))throw new Error('Combined final balances are not zero');
   return after;
  },
  async reconcileFusion(order){
   const status=await fusionStatus({apiKey:need(env,'ONEINCH_API_KEY'),hash:order.hash});
   const now=(await client.getBlock()).timestamp;
   const balances=await c.balances();
   if(status?.status==='filled') {
    if(!status.fills?.length||status.fills.reduce((sum,f)=>sum+BigInt(f.filledMakerAmount),0n)!==order.input)throw new Error('Fusion provider did not report a full fill');
    for(const fill of status.fills){const receipt=await c.receipt(fill.txHash);if(!receipt||!await c.confirmed(receipt))return {status:'pending'};
     const events=parseEventLogs({abi:[orderEvent],logs:receipt.logs,strict:false});
     if(!events.some(e=>lower(e.address)===lower(fusionSpender)&&lower(e.args.orderHash)===lower(order.hash)&&e.args.remainingAmount===0n))throw new Error('Fusion fill receipt does not prove the saved order');
    }
    assertBootstrapSettlement({beforeUsdc:order.before.usdc,afterUsdc:balances.usdc,soldUsdc:order.input,beforeEth:order.before.eth,afterEth:balances.eth,minimumEth:order.minimumEth});
    if(balances.weth!==order.before.weth||balances.shares!==order.before.shares)throw new Error('Unexpected WETH/shares change during Fusion');
    return {status:'filled',fills:status.fills,after:balances};
   }
   // Expiration, not an API rejection/404, makes a fresh authorization safe.
   if(now>order.deadline+60n){assert.deepEqual(balances,order.before,'Expired Fusion order has unexplained balance changes; do not authorize another order');return {status:'expired'};}
   return {status:status?.status??'unknown'};
  },
 };
 c.prepareStep=(action,state,options)=>prepareNativeStep(action,state,c,options);
 return c;
}
