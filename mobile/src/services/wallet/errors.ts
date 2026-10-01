import { AppError, normalizeError } from "@/domain/errors";

/** Normalize both platforms' public codes; never forward native message/userInfo. */
export function walletError(cause: unknown): AppError {
  if (cause instanceof AppError) return cause;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : null;
  switch (code) {
    case "CANCELLED":
    case "WALLET_CANCELLED":
      return new AppError("cancelled");
    case "WALLET_TIMEOUT":
      return new AppError("timeout");
    case "BUSY":
      return new AppError(
        "busy",
        "Another wallet operation is still closing or in progress. Wait a moment, then try again.",
      );
    case "UNAVAILABLE":
      return new AppError(
        "unavailable",
        "Wallet access is unavailable right now. Bring the app to the foreground and try again.",
      );
    case "PASSKEY_FAILED":
      return new AppError(
        "passkey",
        "Apple could not complete the passkey request. Try again. If it keeps failing, contact support with your app version and the step where it stopped.",
      );
    default:
      return normalizeError(cause);
  }
}

export async function callWallet<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (cause) {
    throw walletError(cause);
  }
}
