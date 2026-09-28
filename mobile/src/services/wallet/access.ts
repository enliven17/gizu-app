import { createStoredWalletAccess } from "./storedAccess";
import { getStoredSigner } from "./nativeBridge";

export const nativeWalletAccess = createStoredWalletAccess(getStoredSigner);
