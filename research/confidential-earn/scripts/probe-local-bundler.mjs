// Already-consumed public UserOperation only; this probe cannot use a public relay.
import {readFile,writeFile} from 'node:fs/promises';
import {decodeFunctionData} from 'viem';
import {entryPoint08Abi,entryPoint08Address,formatUserOperationRequest,toUserOperation} from 'viem/account-abstraction';
const fixture=JSON.parse(await readFile(new URL('../fixtures/candide-public-transaction.json',import.meta.url),'utf8'));
const operation=toUserOperation(decodeFunctionData({abi:entryPoint08Abi,data:fixture.tx.input}).args[0][0]);
const rpc=async(method,params)=>fetch('http://127.0.0.1:18560/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(120000)}).then(r=>r.json());
await rpc('debug_bundler_clearState',[]);
const result=await rpc('eth_sendUserOperation',[formatUserOperationRequest(operation),entryPoint08Address]);
await writeFile(new URL('../.local/bundler-diagnostic.json',import.meta.url),JSON.stringify({scope:'Diagnostic only: this probe does not capture or enforce the running local bundler configuration; not an admission certificate',historicalTransaction:fixture.tx.hash,result},null,2)+'\n');
console.log(JSON.stringify(result));
await rpc('debug_bundler_clearState',[]);
