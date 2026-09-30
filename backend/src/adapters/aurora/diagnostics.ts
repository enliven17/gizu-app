export type AuroraDiagnostic = {
  event: "swap.provider";
  operation: string;
  status: number;
  elapsedMs: number;
  outcome: "response" | "transport_error";
};

const operations = [
  "tokens",
  "quote",
  "generate-intent",
  "submit-intent",
  "status",
  "auth/authenticate",
  "account/balances",
];

/** Log only a fixed operation label, never URLs (which contain the API key) or payloads. */
export function diagnosticAuroraFetch(
  emit: (event: AuroraDiagnostic) => void,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return async (input, options) => {
    const started = performance.now();
    const url = new URL(input instanceof Request ? input.url : String(input));
    const operation =
      url.hostname === "rpc.mainnet.near.org"
        ? "auth-salt"
        : (operations.find((name) =>
            url.pathname.startsWith(`/api/${name}/`),
          ) ?? "unknown");
    let status = 0;
    let outcome: AuroraDiagnostic["outcome"] = "transport_error";
    try {
      const response = await fetchImpl(input, options);
      status = response.status;
      outcome = "response";
      return response;
    } finally {
      // Diagnostics must never change the request outcome, even if the sink fails.
      try {
        emit({
          event: "swap.provider",
          operation,
          status,
          elapsedMs: Math.round(performance.now() - started),
          outcome,
        });
      } catch {
        /* logging only */
      }
    }
  };
}
