import {mkdir,open,readFile,rename,unlink,chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {assertCycleComplete} from './native-gas.mjs';
export const json=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?v.toString():v,2);
const encode=value=>JSON.stringify(value,(_k,v)=>typeof v==='bigint'?{$nativeInteger:v.toString()}:v,2);
const decode=value=>JSON.parse(value,(_k,v)=>v&&typeof v==='object'&&Object.keys(v).length===1&&typeof v.$nativeInteger==='string'?BigInt(v.$nativeInteger):v);
export async function withJournal(directory,fn,stem='native-earn-2') {
 await mkdir(directory,{recursive:true,mode:0o700});
 const lock=join(directory,`${stem}.lock`),file=join(directory,`${stem}.json`);
 let handle;
 try {handle=await open(lock,'wx',0o600);} catch(error) {
  if(error.code!=='EEXIST')throw error;
  throw new Error(`Earn journal locked; ensure no command is running before removing ${lock}`);
 }
 try {
  await handle.writeFile(String(process.pid));
  const journal={
   async load(){try{return decode(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}},
   async save(state){const tmp=`${file}.${randomUUID()}.tmp`;const out=await open(tmp,'wx',0o600);try{await out.writeFile(encode(state)+'\n');await out.sync();}finally{await out.close();}await rename(tmp,file);await chmod(file,0o600);},
  };
  return await fn(journal);
 }finally{await handle.close();await unlink(lock);}
}
export async function winningAttempt(attempts,receipt) {
 for(const attempt of attempts){const result=await receipt(attempt.hash);if(result)return {attempt,receipt:result};}
 return null;
}
export function returnOutcome(balances,routes,price) {
 if(routes.some(r=>['REFUNDED','FAILED'].includes(r.status)))return 'route_failed';
 if(!routes.some(r=>r.kind==='usdc')||!routes.some(r=>r.kind==='eth')||routes.some(r=>r.status!=='SUCCESS'))return 'awaiting_aurora';
 try{assertCycleComplete({...balances,ethPriceUsdc:price});return 'complete';}catch{return 'residual_exceeded';}
}
