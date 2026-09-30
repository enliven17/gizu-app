import { nativeWalletAccess } from "@/services/wallet/access";
/* eslint-disable @typescript-eslint/no-require-imports -- Load diagnostic entry points only behind the development gate. */
import "./global.css";
import { AppRoot } from "@/application/AppRoot";
import { validatePasskeyMode } from "@/config/passkeys";
import { resolveDebugScreen } from "@/config/debugScreen";

validatePasskeyMode(process.env.EXPO_PUBLIC_PASSKEY_MODE);
const debugScreen = resolveDebugScreen(process.env.EXPO_PUBLIC_DEBUG_SCREEN, __DEV__);
function NativeApp() {
  return <AppRoot accessService={nativeWalletAccess} />;
}
let Entry = NativeApp;
if (__DEV__ && debugScreen === "stored-wallet") {
  Entry = require("./src/development/stored-wallet/StoredWalletDebugApp").StoredWalletDebugApp;
} else if (__DEV__ && debugScreen === "testnet") {
  Entry = require("./src/development/TestnetDebugApp").TestnetDebugApp;
} else if (__DEV__ && debugScreen === "ui") {
  Entry = require("./src/development/PreviewDebugApp").PreviewDebugApp;
}
export default Entry;
