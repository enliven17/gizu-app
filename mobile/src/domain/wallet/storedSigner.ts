/** Frozen replacement contract. Android and iOS native storage/access/backup implemented; exact transfers and explicit resume supported. */
export const storedSignerIdentity = {
  moduleName: "GizuStoredSigner",
  storageNamespace: "io.gizu.storedwallet.v1",
  backupFormat: "gizu-stored-wallet",
  backupVersion: 2,
  derivationVersion: "gizu-stored-evm-v1",
  recoveryPrfSaltLabel: "gizu.stored-wallet.recovery-prf.v1",
  rpId: "gizu.io",
  chainId: 10143,
} as const;

export type StoredAccount = { accountIndex: number; address: string; chainId: 10143 };
export type StoredWalletState =
  | { status: "absent" }
  | { status: "recoveryRequired" }
  | { status: "backupRequired"; walletId: string }
  | { status: "ready"; walletId: string; accounts: StoredAccount[] };
export type StoredSignerCapabilities = {
  contractVersion: 1;
  available: boolean;
  walletStorage: boolean;
  backup: boolean;
  transfers: boolean;
  swaps: boolean;
  reason?: "notImplemented" | "unsupportedPlatform" | "unsupportedProvider";
};
export type StoredTransferProposal = {
  walletId: string;
  chainId: 10143;
  transfers: {
    accountIndex: number;
    expectedFrom: string;
    to: string;
    valueWei: string;
  }[];
};
export type StoredOperation = {
  operationId: string;
  revision: number;
  walletId: string;
  canResume: boolean;
  blocked: boolean;
  status: "running" | "needsAuthorization" | "needsReview" | "completed" | "cancelled";
  steps: {
    index: number;
    accountIndex: number;
    from: string;
    to: string;
    valueWei: string;
    status: "planned" | "signed" | "pending" | "unknown" | "finalized" | "reverted";
    transactionHash?: string;
    nonce?: string;
    nonceConflict?: boolean;
  }[];
};
export type StoredSwapView = {
  operationId: string;
  phase: string;
  step: string;
  pausedCode: string | null;
  targetSymbol: string;
  targetDecimals: number;
  sourceAtoms: string;
  creditedAtoms: string;
  payoutsSubmitted: number;
  ordersComplete: number;
  receivedTargetAtoms: string;
  fundingAddress: string;
  direction: "buy" | "sell";
  returnAddresses: string[];
};

/** All dialogs, file IO and authorization originate natively. No JS approve/export API. */
export interface StoredSignerContract {
  getCapabilities(): Promise<StoredSignerCapabilities>;
  getWalletState(): Promise<StoredWalletState>;
  createWallet(): Promise<StoredWalletState>;
  openWallet(): Promise<StoredWalletState>;
  /** Native save + reopen + verify ceremony; never returns file contents or paths. */
  backupWallet(): Promise<StoredWalletState>;
  restoreWallet(): Promise<StoredWalletState>;
  executeOperation(proposal: StoredTransferProposal): Promise<StoredOperation>;
  listOperations(): Promise<StoredOperation[]>;
  getOperationStatus(operationId: string): Promise<StoredOperation>;
  /** Reconcile then obtain new native review and passkey authorization; never automatic. */
  resumeOperation(operationId: string, expectedRevision: number): Promise<StoredOperation>;
  cancelOperation(operationId: string): Promise<StoredOperation>;
  getSwapDeposit(): Promise<{ fundingAddress: string }>;
  startSwap(target: string, amountAtoms: string, gateway: string): Promise<StoredSwapView>;
  startSell(gateway: string): Promise<StoredSwapView>;
  resumeSwap(gateway: string): Promise<StoredSwapView>;
  getSwapStatus(gateway: string): Promise<StoredSwapView>;
  cancelSwap(gateway: string): Promise<StoredSwapView>;
  lock(): void;
}
