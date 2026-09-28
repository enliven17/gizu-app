import { resolveDebugScreen } from "@/config/debugScreen";

test("normal startup supports release while diagnostics remain development-only", () => {
  expect(resolveDebugScreen(undefined, true)).toBeUndefined();
  expect(resolveDebugScreen(undefined, false)).toBeUndefined();
});
test.each(["ui", "stored-wallet"])("explicit %s launch requires development", (screen) => {
  expect(resolveDebugScreen(screen, true)).toBe(screen);
  expect(() => resolveDebugScreen(screen, false)).toThrow("development-only");
});
test("disconnected and unknown debug selections fail closed", () => {
  expect(() => resolveDebugScreen("signer", true)).toThrow("disconnected");
  expect(() => resolveDebugScreen("wallet", true)).toThrow("disconnected");
  expect(() => resolveDebugScreen("unknown", true)).toThrow("Unknown");
});
