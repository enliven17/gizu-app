import { AppRoot } from "@/application/AppRoot";
import type { AccessService } from "@/services/access";
import { createNativeWalletAccess } from "./legacySigner/access";
import { getNativeSigner } from "./legacySigner/nativeBridge";
import { WalletScreen, type WalletDependencies } from "./wallet/WalletScreen";

const legacyAccess = createNativeWalletAccess(getNativeSigner);

/** Standalone native-wallet harness, never part of the product navigator. */
export function WalletDebugApp({
  accessService = legacyAccess,
  walletDependencies,
}: {
  accessService?: AccessService;
  walletDependencies?: WalletDependencies;
}) {
  return (
    <AppRoot
      accessService={accessService}
      renderNativeSession={(session) => (
        <WalletScreen key={session.accountId} session={session} dependencies={walletDependencies} />
      )}
    />
  );
}
