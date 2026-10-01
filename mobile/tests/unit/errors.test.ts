import { AppError, errorMessage, normalizeError } from "@/domain/errors";
import { callWallet, walletError } from "@/services/wallet/errors";

test.each([undefined, null, "secret", new Error("secret"), { message: "secret", code: "unknown" }])(
  "unknown errors never expose payloads: %#",
  (cause) => {
    expect(errorMessage(cause, "Safe fallback")).toBe("Safe fallback");
    expect(normalizeError(cause)).toMatchObject({ code: "unknown" });
  },
);
test("app-authored errors retain categories and safe text", () => {
  const error = new AppError("recovery-required", "Restore your backup.");
  expect(normalizeError(error)).toBe(error);
  expect(walletError(error)).toBe(error);
  expect(errorMessage(error, "fallback")).toBe("Restore your backup.");
  expect(normalizeError({ name: "AbortError", message: "secret" }).code).toBe("cancelled");
});
test.each([
  ["CANCELLED", "cancelled"],
  ["WALLET_CANCELLED", "cancelled"],
  ["WALLET_TIMEOUT", "timeout"],
  ["BUSY", "busy"],
  ["UNAVAILABLE", "unavailable"],
  ["PASSKEY_FAILED", "passkey"],
  ["NETWORK_ERROR", "network"],
  ["INVALID_INPUT", "validation"],
  ["INVALID_RESPONSE", "invalid-response"],
  ["VERIFICATION_FAILED", "verification-failed"],
  ["RECOVERY_REQUIRED", "recovery-required"],
  ["INSUFFICIENT_BALANCE", "validation"],
  ["WALLET_FAILED", "unknown"],
  ["WALLET_STOPPED", "unknown"],
])("normalizes %s without native messages", async (code, expected) => {
  const result = callWallet(() => Promise.reject({ code, message: "secret", userInfo: "secret" }));
  await expect(result).rejects.toMatchObject({ code: expected });
  await expect(result).rejects.not.toHaveProperty("userInfo");
  await expect(result).rejects.not.toThrow("secret");
});
test("native success is returned once; synchronous exceptions are sanitized", async () => {
  const operation = jest.fn().mockResolvedValue({ status: "ready" });
  await expect(callWallet(operation)).resolves.toEqual({ status: "ready" });
  expect(operation).toHaveBeenCalledTimes(1);
  await expect(
    callWallet(() => {
      throw new Error("secret");
    }),
  ).rejects.toMatchObject({ code: "unknown" });
});
