// Read-only checks: never quote, authenticate, sign or submit a transaction.
import { resolveEnv } from "../src/secret/env-file.ts";
import { AuroraIntents } from "../src/adapters/aurora/aurora-intents.ts";
import { diagnosticAuroraFetch } from "../src/adapters/aurora/diagnostics.ts";
import { InfrastructureError } from "../src/domain/errors/infrastructure-error.ts";

const env = resolveEnv();
let failed = false;
for (const name of ["AURORA_API_KEY", "PIMLICO_API_KEY", "ONEINCH_API_KEY"]) {
  const configured = !!env[name]?.trim();
  console.log(JSON.stringify({ check: name, configured }));
  if (!configured) failed = true;
}
if (env.AURORA_API_KEY?.trim()) {
  const aurora = new AuroraIntents(
    env.AURORA_API_KEY,
    diagnosticAuroraFetch((event) => console.log(JSON.stringify(event))),
  );
  for (const [check, run] of [
    [
      "aurora.tokens",
      async () => ({ tokenCount: (await aurora.tokens()).length }),
    ],
    [
      "aurora.auth-salt",
      async () => {
        await aurora.authSalt();
        return {};
      },
    ],
  ] as const) {
    try {
      console.log(JSON.stringify({ check, ok: true, ...(await run()) }));
    } catch (error) {
      failed = true;
      console.log(
        JSON.stringify({
          check,
          ok: false,
          code:
            error instanceof InfrastructureError
              ? error.code
              : "INVALID_RESPONSE",
        }),
      );
    }
  }
}
process.exitCode = failed ? 1 : 0;
