// Safe entry point: lab signs synthetic accounts and submits only to loopback.
import {safeCliError} from '../src/cli-error.mjs';
try { await import('./robinhood-cycle-lab.mjs'); }
catch(error) { console.error(safeCliError(error)); process.exitCode=1; }
