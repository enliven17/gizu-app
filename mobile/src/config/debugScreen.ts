type DebugScreen = "ui" | "stored-wallet";

export function resolveDebugScreen(
  screen: string | undefined,
  development: boolean,
): DebugScreen | undefined {
  if (!screen) {
    return undefined;
  }
  if (!development) throw new Error("Debug screens are development-only.");
  if (screen === "wallet" || screen === "signer")
    throw new Error("Legacy signer diagnostics are disconnected from the app.");
  if (screen !== "stored-wallet" && screen !== "ui") throw new Error("Unknown debug screen.");
  return screen;
}
