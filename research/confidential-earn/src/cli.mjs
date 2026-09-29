import {run} from './runner.mjs';
import {safeCliError} from './cli-error.mjs';
try { await run(process.argv[2],process.argv[3],process.argv[4]); }
catch (error) {
  let message=safeCliError(error);
  for(const name of ['PIMLICO_API_KEY','ONEINCH_API_KEY','AURORA_API_KEY']){const key=process.env[name]?.trim();if(key)message=message.replaceAll(encodeURIComponent(key),'[REDACTED]').replaceAll(key,'[REDACTED]');}
  console.error(message);
  process.exitCode=1;
}
