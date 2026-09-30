import { AppRoot } from "@/application/AppRoot";
import { createStoredWalletAccess } from "@/services/wallet/storedAccess";
import { getStoredSigner } from "@/services/wallet/nativeBridge";
import type { AccessService } from "@/services/access";
const access = createStoredWalletAccess(getStoredSigner);
const testnetAccess: AccessService = {
  method: "Passkey",
  cancel: access.cancel,
  async request(method) {
    const opened = await access.request(method);
    const state = await getStoredSigner()?.getWalletState();
    if (opened.kind !== "mainnet" || state?.status !== "ready")
      throw new Error("Open a verified wallet first");
    const account = state.accounts.find((account) => account.accountIndex === 0);
    if (!account) throw new Error("Testnet account unavailable");
    return {
      ...opened,
      kind: "testnet",
      chainId: 10143,
      accountIndex: 0,
      address: account.address,
      accountId: account.address.toLowerCase(),
    };
  },
};
/** Development-only retained MON transfer harness; never routed from the normal app. */
export function TestnetDebugApp() {
  return <AppRoot accessService={testnetAccess} />;
}
