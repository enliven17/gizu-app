/** React Native AbortSignal supports `aborted`, but not `throwIfAborted`. */
export function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("Request cancelled.");
  error.name = "AbortError";
  throw error;
}
