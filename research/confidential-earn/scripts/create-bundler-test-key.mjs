import {mkdir,writeFile} from 'node:fs/promises';
import {generatePrivateKey} from 'viem/accounts';
await mkdir(new URL('../.local/',import.meta.url),{recursive:true,mode:0o700});
try{await writeFile(new URL('../.local/bundler-test-key',import.meta.url),generatePrivateKey(),{mode:0o600,flag:'wx'});console.log('Created an unfunded local test bundler key.');}
catch(error){if(error.code!=='EEXIST')throw error;console.log('Existing local test bundler key retained.');}
