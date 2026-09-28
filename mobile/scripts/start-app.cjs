const { spawn } = require("node:child_process");
const screen = process.argv[2];
if (!["app", "ui", "stored-wallet"].includes(screen)) {
  throw new Error("Expected app, ui or stored-wallet. Legacy signer diagnostics are disconnected.");
}
const child = spawn(
  process.execPath,
  [require.resolve("expo/bin/cli"), "start", "--dev-client", ...process.argv.slice(3)],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      EXPO_PUBLIC_DEBUG_SCREEN: screen === "app" ? "" : screen,
      EXPO_PUBLIC_PASSKEY_MODE: "native",
    },
  },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
