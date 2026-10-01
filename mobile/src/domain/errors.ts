export type AppErrorCode =
  | "cancelled"
  | "timeout"
  | "network"
  | "unavailable"
  | "busy"
  | "invalid-response"
  | "validation"
  | "verification-failed"
  | "passkey"
  | "backup-required"
  | "recovery-required"
  | "unknown";

/** Messages must be authored by the app, never copied from a provider or native error. */
export class AppError extends Error {
  constructor(
    public readonly code: AppErrorCode,
    public readonly userMessage?: string,
  ) {
    super(userMessage ?? code);
    this.name = "AppError";
  }
}

/** Unknown exceptions deliberately lose their message and payload at the UI boundary. */
export function normalizeError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  if (cause && typeof cause === "object" && "name" in cause && cause.name === "AbortError")
    return new AppError("cancelled");
  return new AppError("unknown");
}

export function errorMessage(cause: unknown, fallback: string): string {
  return normalizeError(cause).userMessage ?? fallback;
}
