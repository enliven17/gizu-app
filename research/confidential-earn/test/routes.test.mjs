import test from 'node:test';
import assert from 'node:assert/strict';
import {routeProfile,routeEnvironment,assertRouteState,assertNewRouteVaultReady} from '../src/routes.mjs';
test('route profiles pin chain, asset, vault and isolated state',()=>{
 const eth=routeProfile('ethereum'),hood=routeProfile('robinhood');
 assert.equal(eth.chain.id,1);assert.equal(hood.chain.id,4663);
 assert.equal(hood.symbol,'USDG');assert.equal(hood.vault.toLowerCase(),'0xbeeff033f34c046626b8d0a041844c5d1a5409dd');
 assert.notEqual(eth.directory,hood.directory);assert.throws(()=>routeProfile('base'));
});
test('both route profiles use the same authorized destination credentials',()=>{
 const env={DEST1_ADD:'a',DEST1_PK:'b',DEST2_ADD:'c',DEST2_PK:'d',CONFIDENTIAL_PK:'legacy'};
 for(const route of ['ethereum','robinhood']){
  const result=routeEnvironment(route,env);assert.equal(result.DEST1_ADD,'a');assert.equal(result.DEST2_PK,'d');assert.equal(result.CONFIDENTIAL_PK,undefined);
 }
});
test('wrong-route journals fail closed',()=>{
 const p=routeProfile('robinhood');
 assert.throws(()=>assertRouteState({route:'ethereum',chainId:1},p));
 assert.doesNotThrow(()=>assertRouteState({route:'robinhood',chainId:4663},p));
});
test('new route rejects existing shares or wrong vault asset before funding',async()=>{
 const p=routeProfile('ethereum');
 await assert.rejects(assertNewRouteVaultReady(p,{readContract:async a=>a.functionName==='asset'?p.token:1n},'owner'),/already owns/);
 await assert.rejects(assertNewRouteVaultReady(p,{readContract:async()=>routeProfile('robinhood').token},'owner'),/underlying/);
});
test('new Robinhood deposit rejects existing ETH; Ethereum can reuse its own ETH',async()=>{
 for(const name of ['ethereum','robinhood']){
  const p=routeProfile(name),client={readContract:async a=>a.functionName==='asset'?p.token:0n,getBalance:async()=>1n};
  if(name==='robinhood')await assert.rejects(assertNewRouteVaultReady(p,client,'owner'),/zero destination ETH/);
  else await assertNewRouteVaultReady(p,client,'owner');
 }
});
test('Ethereum captures existing shares and rejects a changed baseline before funding',async()=>{
 const p=routeProfile('ethereum'),c={readContract:async a=>a.functionName==='asset'?p.token:7n};
 assert.equal(await assertNewRouteVaultReady(p,c,'owner',{allowExisting:true}),7n);
 assert.equal(await assertNewRouteVaultReady(p,c,'owner',{allowExisting:true,expectedShares:7n}),7n);
 await assert.rejects(assertNewRouteVaultReady(p,c,'owner',{allowExisting:true,expectedShares:6n}),/changed/);
 const hood=routeProfile('robinhood');await assert.rejects(assertNewRouteVaultReady(hood,{readContract:async a=>a.functionName==='asset'?hood.token:7n},'owner',{allowExisting:true}),/already owns/);
});
