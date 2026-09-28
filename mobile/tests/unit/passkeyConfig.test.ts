import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { identity, validatePasskeyMode } from "../../src/config/passkeys";

test("freezes shared RP and deterministic account-zero recipe without wallet secrets", () => {
  expect(identity.rpId).toBe("gizu.io");
  expect(identity.sharedWebMobileWallets).toBe(true);
  expect(identity.sharedDevelopmentProductionRp).toBe(true);
  expect(identity.derivation).toEqual({
    version: "mera-evm-v1",
    prfSaltLabel: "mera.prf.salt.v1",
    prfSaltHex: createHash("sha256").update("mera.prf.salt.v1").digest("hex"),
    prfBytes: 32,
    mnemonicLanguage: "english",
    bip39Passphrase: "",
    path: "m/44'/60'/0'/0/0",
    accountIndex: 0,
  });
  expect(identity.minimumPasskeyOs).toEqual({ iosMajor: 18, androidApi: 28 });
});

test("native modes are explicit and invalid modes cannot silently use demo success", () => {
  expect(validatePasskeyMode(undefined)).toBe("native");
  expect(() => validatePasskeyMode("mock")).toThrow("PASSKEY_MODE must be native.");
  expect(() => validatePasskeyMode("typo")).toThrow("PASSKEY_MODE");
  expect(validatePasskeyMode("native")).toBe("native");
});

test("frontend Apple association includes the configured mobile identity", () => {
  const association = JSON.parse(
    readFileSync(
      resolve(__dirname, "../../../frontend/public/.well-known/apple-app-site-association"),
      "utf8",
    ),
  );
  expect(association.webcredentials.apps).toContain(
    `${identity.appleTeamId}.${identity.iosBundleIdentifier}`,
  );
});
