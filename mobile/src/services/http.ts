import { AppError } from "@/domain/errors";

const TIMEOUT_MS = 12_000;

/** GET JSON with the caller's cancellation plus a 12 s timeout. */
export async function getJson(
  url: string,
  signal: AbortSignal,
  unavailable: string,
): Promise<unknown> {
  return requestJson(url, { signal }, unavailable);
}

/** No retries: callers decide whether another request is safe for their operation. */
export async function requestJson(
  url: string,
  options: RequestInit & { signal: AbortSignal },
  unavailable: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const { signal } = options;
  const controller = new AbortController();
  let stopped: "cancelled" | "timeout" | undefined;
  const abort = () => {
    stopped ??= "cancelled";
    controller.abort();
  };
  if (signal.aborted) throw new AppError("cancelled");
  signal.addEventListener("abort", abort);
  const timeout = setTimeout(() => {
    stopped ??= "timeout";
    controller.abort();
  }, TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new AppError("unavailable", unavailable);
    try {
      const body: unknown = await response.json();
      if (stopped) throw new AppError(stopped);
      return body;
    } catch (cause) {
      if (cause instanceof AppError) throw cause;
      throw new AppError("invalid-response", "The service returned invalid JSON.");
    }
  } catch (cause) {
    if (stopped) throw new AppError(stopped);
    if (cause instanceof AppError) throw cause;
    throw new AppError(
      "network",
      "Could not connect to the service. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}
