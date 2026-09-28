import type { StoredOperation } from "./storedSigner";
export type WalletTransfer = {
  transactionHash: string;
  status: string;
  nonce: string;
  to?: string;
  valueWei?: string;
};
export type WalletHistory = {
  entries: WalletTransfer[];
  blocked: boolean;
  operations?: StoredOperation[];
};
export interface WalletTransferService {
  history(address: string): Promise<WalletHistory>;
  send(address: string, recipient: string, amount: string): Promise<WalletHistory>;
  resume?(address: string, operationId: string, revision: number): Promise<WalletHistory>;
  cancelOperation?(address: string, operationId: string): Promise<WalletHistory>;
  cancel(): void;
}
