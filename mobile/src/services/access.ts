export type AccessMethod = "Demo passkey" | "Passkey";
export type DemoSession = { kind: "demo"; method: AccessMethod; accountId?: string };
export type WalletSession = {
  kind: "testnet";
  method: "Passkey";
  accountId: string;
  address: string;
  accountIndex: 0;
  chainId: 10143;
  walletId?: string;
};
export type AppSession = DemoSession | WalletSession;
export interface AccessService {
  method?: AccessMethod;
  cancel?(): void;
  canRestore?(): Promise<boolean>;
  restore?(): Promise<AppSession>;
  request(method: AccessMethod): Promise<AppSession>;
}
export class AccessRejectedError extends Error {}
// No device credentials, network calls or signing. Session lasts only in memory.
export const demoAccessService: AccessService = {
  async request(method) {
    return { kind: "demo", method };
  },
};
