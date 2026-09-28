import {run} from './runner.mjs';
try { await run(process.argv[2],process.argv[3]); }
catch (error) {
  const key=process.env.PIMLICO_API_KEY?.trim();
  console.error(key?error.message.replaceAll(encodeURIComponent(key),'[REDACTED]').replaceAll(key,'[REDACTED]'):error.message);
  process.exitCode=1;
}
