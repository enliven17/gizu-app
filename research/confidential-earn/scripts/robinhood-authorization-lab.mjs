// Fresh-wallet EIP-7702 authorization, signed and included only on a local fork.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createPublicClient,createWalletClient,http,toHex} from 'viem';
import {privateKeyToAccount,generatePrivateKey} from 'viem/accounts';
import {withNativeFork} from '../src/native-simulation.mjs';
import {createHoodPaymaster} from '../src/robinhood-paymaster.mjs';
import {hood} from '../src/robinhood-vault.mjs';
import {json} from '../src/native-runtime.mjs';
const upstream=process.env.ROBINHOOD_RPC_URL||hood.rpc;
const publicClient=createPublicClient({transport:http(upstream)}),block=await publicClient.getBlock();
await withNativeFork({rpcUrl:upstream,blockNumber:block.number,chain:hood.chain,anvilPath:process.env.ANVIL_PATH||'anvil'},async client=>{
 assert.equal(new URL(client.transport.url).hostname,'127.0.0.1');
 const key=generatePrivateKey(),owner=privateKeyToAccount(key),relayer=privateKeyToAccount(generatePrivateKey());
 const aa=await createHoodPaymaster({client,owner:owner.address,env:{...process.env,DEST2_PK:key}});
 const authorization=await aa.authorize();assert.equal(authorization.chainId,4663);assert.equal(authorization.nonce,0);
 await client.request({method:'anvil_setBalance',params:[relayer.address,toHex(10n**18n)]});
 const wallet=createWalletClient({account:relayer,chain:hood.chain,transport:http(client.transport.url)});
 const hash=await wallet.sendTransaction({to:owner.address,value:0n,data:'0x',authorizationList:[authorization],gas:100000n});
 const receipt=await client.waitForTransactionReceipt({hash});assert.equal(receipt.status,'success');
 assert.equal((await client.getCode({address:owner.address})).toLowerCase(),`0xef0100${authorization.address.slice(2)}`.toLowerCase());
 assert.equal(await client.getBalance({address:owner.address}),0n);assert.equal(await client.getTransactionCount({address:owner.address}),1);
 await writeFile(new URL('../fixtures/robinhood-authorization.json',import.meta.url),json({scope:'Synthetic fresh wallet, production authorize() method, type-4 authorization included only on local fork. Public bundler attachment/inclusion not tested.',block:block.number,chainId:4663,success:true,ownerEth:0n,ownerNonce:1})+'\n');
 console.log('Fresh Robinhood EIP-7702 authorization passed on local fork.');
});
