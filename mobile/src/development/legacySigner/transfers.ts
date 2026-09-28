import { transferProposal, walletAddressPattern } from "@/domain/wallet/transfers";
import type { WalletTransferService } from "@/domain/wallet/types";
import { getNativeSigner, type NativeTransfers } from "./nativeBridge";
import { walletHistory } from "./journal";
export function createWalletTransfers(
  getBridge: () => NativeTransfers | null,
): WalletTransferService {
  function bridge() {
    const native = getBridge();
    if (!native?.executeOperation || !native.getOperationStatus)
      throw new Error("Native transfers unavailable");
    return native;
  }
  return {
    async history(address) {
      return walletHistory(await bridge().getOperationStatus(), address);
    },
    async send(address, recipient, amount) {
      if (!walletAddressPattern.test(address)) throw new Error("Invalid wallet");
      const proposal = JSON.parse(transferProposal("0", recipient, amount));
      proposal.transfers[0].expectedFrom = address;
      return walletHistory(await bridge().executeOperation(JSON.stringify(proposal)), address);
    },
    cancel() {
      getBridge()?.cancelOperation();
    },
  };
}
export const nativeWalletTransfers = createWalletTransfers(getNativeSigner);
