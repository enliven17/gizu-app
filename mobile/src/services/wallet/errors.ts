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
    case "NETWORK_ERROR":
      return new AppError(
        "network",
        "Could not connect to the service. Check your connection and try again.",
      );
    case "INVALID_INPUT":
      return new AppError("validation");
    case "INVALID_RESPONSE":
      return new AppError("invalid-response");
    case "VERIFICATION_FAILED":
      return new AppError(
        "verification-failed",
        "Wallet verification failed. Check your wallet and operation status before retrying.",
      );
    case "RECOVERY_REQUIRED":
      return new AppError(
        "recovery-required",
        "Local wallet storage could not be read. Restore your backup using the original passkey.",
      );
    case "INSUFFICIENT_BALANCE":
      return new AppError("validation", "Not enough funds for the operation and its network fees.");
    case "PASSKEY_FAILED":
      return new AppError(
        "passkey",
        "The passkey request could not be completed. Try again. If it keeps failing, contact support with your app version and the step where it stopped.",
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
