// LOCAL TEST FIXTURE: deterministic fee recommendations, never a live RPC.
// All non-fee requests go only to the local Anvil instance.
import http from 'node:http';
const upstream='http://127.0.0.1:18554';
const tip=20_000_000n;
async function call(p){
 if(p.method==='eth_maxPriorityFeePerGas')return{jsonrpc:'2.0',id:p.id,result:`0x${tip.toString(16)}`};
 if(p.method==='eth_gasPrice'){
  const r=await call({jsonrpc:'2.0',id:p.id,method:'eth_getBlockByNumber',params:['latest',false]});
  if(r.error)return r;
  return{jsonrpc:'2.0',id:p.id,result:`0x${(BigInt(r.result.baseFeePerGas)+tip).toString(16)}`};
 }
 return fetch(upstream,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(p),signal:AbortSignal.timeout(120000)}).then(r=>r.json());
}
http.createServer(async(req,res)=>{
 try{let body='';for await(const c of req)body+=c;const request=JSON.parse(body);const result=Array.isArray(request)?await Promise.all(request.map(call)):await call(request);res.setHeader('content-type','application/json');res.end(JSON.stringify(result));}
 catch{res.writeHead(500);res.end('Local test RPC failed');}
}).listen(18561,'127.0.0.1',()=>console.log('Local market fixture: port 18561, Anvil 18554, priority 20000000 wei.'));
