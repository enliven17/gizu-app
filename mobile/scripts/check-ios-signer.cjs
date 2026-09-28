const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "../ios");
const support = path.join(root, "Pods/Target Support Files");
const providers = fs
  .readdirSync(support)
  .filter((name) => /^Pods-Gizu(?:Dev)?$/.test(name))
  .map((name) => path.join(support, name, "ExpoModulesProvider.swift"))
  .filter((file) => fs.existsSync(file));
if (providers.length !== 1)
  throw new Error(
    "Expected one generated Gizu app registration. Run iOS prebuild and pod install.",
  );
const provider = fs.readFileSync(providers[0], "utf8");
const lock = fs.readFileSync(path.join(root, "Podfile.lock"), "utf8");
if (
  !provider.includes("GizuStoredSignerModule.self") ||
  /\bGizuSignerModule\b/.test(provider) ||
  /^\s+- GizuSigner(?:\s|\()/m.test(lock)
) {
  throw new Error(
    "Expected only GizuStoredSigner in the generated iOS registration and Pods graph.",
  );
}
console.log(
  "iOS registration and Pods graph include the stored signer and exclude the retired signer.",
);
