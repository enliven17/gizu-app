// @ts-check
// CommonJS is shared by Expo config evaluation and Metro.
const identity = require("./passkey-identity.json");

/** @param {string | undefined} mode */
function validatePasskeyMode(mode) {
  if (mode !== undefined && mode !== "native") throw new Error("PASSKEY_MODE must be native.");
  return "native";
}

module.exports = { identity, validatePasskeyMode };
