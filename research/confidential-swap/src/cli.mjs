import {run} from './runner.mjs';
try { await run(process.argv[2],process.argv[3]); }
catch (error) {
  const keys=[process.env.PIMLICO_API_KEY,process.env.ONEINCH_API_KEY].map(k=>k?.trim()).filter(Boolean);
  console.error(keys.reduce((message,key)=>message.replaceAll(encodeURIComponent(key),'[REDACTED]').replaceAll(key,'[REDACTED]'),error.message));
  process.exitCode=1;
}
