// Local fork only: real existing shares, synthetic USDC/ETH funding, real CLI.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createPublicClient,http,erc20Abi,encodeFunctionData,toHex,parseAbi} from 'viem';
import {mainnet} from 'viem/chains';
import {withNativeFork,simulateSequence} from '../src/native-simulation.mjs';
import {runNative} from '../src/native-cli.mjs';
import {createNativeContext} from '../src/native-context.mjs';
import {usdc,vault,tokenBalance} from '../src/native-vault.mjs';
import {json} from '../src/native-runtime.mjs';
import {marketFees} from '../src/native-planner.mjs';
import {readTokenPrices} from '../src/token-prices.mjs';
const rpcUrl=process.env.ETHEREUM_RPC_URL||'https://ethereum-rpc.publicnode.com';
const preview=process.argv.includes('--preview'),testAmount=BigInt(process.env.FORK_USDC_ATOMS||'6000000');
const remote=createPublicClient({chain:mainnet,transport:http(rpcUrl)}),referenceFees=preview?await marketFees(remote):undefined,block=referenceFees?.block??await remote.getBlock();
const previewPrice=preview?(await readTokenPrices({apiKey:process.env.AURORA_API_KEY,assetIds:['nep141:eth.omft.near']}))[0]:undefined;
const owner=process.env.DEST2_ADD,other=process.env.DEST1_ADD;
const root=await mkdtemp(join(tmpdir(),'existing-shares-fork-')),directory=join(root,'.local/ethereum');await mkdir(directory,{recursive:true});
try{await withNativeFork({rpcUrl,blockNumber:block.number,anvilPath:process.env.ANVIL_PATH},async client=>{
 const localRpc=client.transport.url;assert(new URL(localRpc).hostname==='127.0.0.1');
 const initialShares=await tokenBalance(client,vault,owner);assert(initialShares>0n);
 const initialAssets=await client.readContract({address:vault,abi:parseAbi(['function previewRedeem(uint256) view returns(uint256)']),functionName:'previewRedeem',args:[initialShares]});
 const otherBefore={usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)};
 const donor='0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8';
 await simulateSequence(client,donor,[{to:usdc,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[owner,testAmount]})}],block.baseFeePerGas*2n+100000000n);
 await client.request({method:'anvil_setBalance',params:[owner,toHex(preview?0n:10n**17n)]});
 if(preview){await client.request({method:'anvil_setNextBlockBaseFeePerGas',params:[toHex(block.baseFeePerGas)]});await client.request({method:'evm_mine'});}
 const legacy=JSON.parse(await readFile(new URL('../.local/state.json',import.meta.url)));
 const route={...legacy,route:'ethereum',chainId:1,initialVaultShares:String(initialShares),recipients:[other,owner],payouts:[{status:'delivered'},{status:'delivered'}]};
 await writeFile(join(directory,'state.json'),JSON.stringify(route),{mode:0o600});
 const env={...process.env,EARN_ROUTE:'ethereum',ETHEREUM_RPC_URL:localRpc};const evidence=[];
 const factory=async args=>{const c=await createNativeContext(args);assert.equal(c.initialShares,initialShares);c.price=async()=>previewPrice??2700n*1000000n;if(preview){
  // Donor funding and empty synthetic blocks must not lower the real fee bid.
  c.fees=async()=>({...referenceFees,block:await client.getBlock()});
  const sim=c.simulate,quote=c.quoteFusion;c.simulate=async o=>{const r=await sim(o);console.log(json({stage:'simulation',depositGas:r.deposit.map(t=>t.estimatedGas),withdrawalGas:r.withdrawalGas,budget:r.budget}));return r;};c.quoteFusion=async input=>{const q=await quote(input);console.log(json({stage:'fusion_quote',input,minimumEth:q.minimumEth}));return q;};}if(!preview)c.quoteFusion=()=>assert.fail('This test supplies local native gas');c.prepareFusion=()=>assert.fail('Unexpected Fusion signature');c.quoteReturn=()=>assert.fail('Return outside this test scope');return c;};
 async function command(action){const s=await runNative(action,'2',undefined,{root,directory,env,contextFactory:factory,print:x=>evidence.push(x)});await client.request({method:'evm_mine'});return s;}
 if(preview){const p=await runNative('native-preview','2','deposit',{root,directory,env,contextFactory:factory,print:x=>{if(x.summary)console.log(json({summary:x.summary}));}});const result={scope:'Unsigned Fusion quote and local-fork preview; synthetic USDC balance, actual existing shares and pinned mainnet fee history',block:block.number,referenceFees,initialShares,testAmount,amount:p.amount,funding:p.funding,simulation:p.simulation,summary:p.summary};await writeFile(new URL('../.local/mainnet-preflight/ethereum-deposit-preview.json',import.meta.url),json(result));console.log(json({block:block.number,initialShares,testAmount,amount:p.amount,funding:p.funding,gas:p.simulation?.budget}));return;}
 let s;for(let i=0;i<5;i++){s=await command('native-deposit');if(s.phase==='invested')break;}
 assert.equal(s.phase,'invested');assert.equal(s.initialShares,initialShares);assert.equal(await tokenBalance(client,usdc,owner),50000n);const totalShares=await tokenBalance(client,vault,owner);assert(totalShares>initialShares);
 for(let i=0;i<5;i++){s=await command('native-withdraw');if(s.phase==='withdrawn')break;}
 assert.equal(s.phase,'withdrawn');assert.equal(await tokenBalance(client,vault,owner),0n);const assets=await tokenBalance(client,usdc,owner);assert(assets>=testAmount+initialAssets-10n);
 assert.deepEqual({usdc:await tokenBalance(client,usdc,other),eth:await client.getBalance({address:other}),shares:await tokenBalance(client,vault,other)},otherBefore);
 const result={scope:'Real Ethereum fork and production native CLI. Existing on-chain shares retained; 6 USDC and ETH supplied on fork only. No public transactions or provider orders.',block:block.number,initialShares,initialAssets,totalShares,finalUsdc:assets,finalShares:0n,phase:s.phase,evidence};await writeFile(new URL('../fixtures/native-existing-shares.json',import.meta.url),json(result)+'\n');console.log(json({block:block.number,initialShares,initialAssets,totalShares,finalUsdc:assets,finalShares:0n,phase:s.phase}));
 });}finally{await rm(root,{recursive:true,force:true});}
