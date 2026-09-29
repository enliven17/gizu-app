const TIMEOUT_MS = 12_000;

/** GET JSON with the caller's cancellation plus a 12 s timeout. */
export async function getJson(
  url: string,
  signal: AbortSignal,
  unavailable: string,
): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort);
  if (signal.aborted) abort();
  const timeout = setTimeout(abort, TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(unavailable);
    return (await response.json()) as unknown;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
