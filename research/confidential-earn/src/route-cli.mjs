import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {routeEnvironment,routeProfile} from './routes.mjs';
import {withJournal} from './native-runtime.mjs';
import {safeCliError} from './cli-error.mjs';
try{
 const [route,command,arg,detail]=process.argv.slice(2),profile=routeProfile(route);
 Object.assign(process.env,routeEnvironment(route,process.env));delete process.env.CONFIDENTIAL_PK;
 const root=fileURLToPath(new URL('..',import.meta.url));process.chdir(root);
 // One command across both routes at a time, including Monad source signing.
 await withJournal(join(root,'.local'),async()=>{
  if(['preview','deposit','withdraw','return','earn-status','resubmit','reprice'].includes(command)){
   if(route==='ethereum'){
    if(command==='resubmit')throw new Error('Repeat the pending native action; use native-reprice only for fee replacement');
    const {runNative}=await import('./native-cli.mjs');
    return runNative(command==='earn-status'?'native-status':`native-${command}`,arg??'2',detail,{directory:join(root,profile.directory)});
   }
   const {runRobinhood}=await import('./robinhood-cli.mjs');return runRobinhood(command,arg??'2',detail);
  }
  const {run}=await import('./runner.mjs');return run(command==='payout-resubmit'?'resubmit':command,arg,detail);
 },'route-command');
}catch(error){let message=safeCliError(error);for(const name of ['PIMLICO_API_KEY','ONEINCH_API_KEY','AURORA_API_KEY','CANDIDE_API_KEY']){const key=process.env[name]?.trim();if(key)message=message.replaceAll(encodeURIComponent(key),'[REDACTED]').replaceAll(key,'[REDACTED]');}console.error(message);process.exitCode=1;}
