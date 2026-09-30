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
  /** Funds may be in flight once approved; the app pauses such operations, never cancels them. */
  approved: boolean;
  returnAddresses: string[];
};

export type SwapHolding = {
  token: string;
  chainId: 4663;
  symbol: string;
  decimals: number;
  balanceAtoms: string;
  batches: { id: string; balanceAtoms: string }[];
};
export type SwapHoldingsSnapshot = {
  holdings: SwapHolding[];
  checkedAt: number;
  block: string;
};

export type MainnetPortfolioSnapshot = {
  walletId: string;
  chainId: 143;
  asset: "USDC";
  decimals: 6;
  fundingAddress: string;
  fundingAtoms: string;
  returnAtoms: string;
  totalAtoms: string;
  checkedAt: number;
  block: string;
  accounts: {
    address: string;
    accountIndex: number;
    role: "funding" | "receiving";
    balanceAtoms: string;
  }[];
  history: {
    operationId: string;
    phase: string;
    direction: "buy" | "sell";
    symbol: string;
    receivedAtoms: string;
    recordedAt: number;
  }[];
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
  getMainnetPortfolio(): Promise<MainnetPortfolioSnapshot>;
  getSwapDeposit(): Promise<{ fundingAddress: string }>;
  startSwap(target: string, amountAtoms: string, gateway: string): Promise<StoredSwapView>;
  getSwapHoldings(target: string): Promise<SwapHoldingsSnapshot>;
  sellSwapHolding(holdingId: string, gateway: string): Promise<StoredSwapView>;
  startSell(gateway: string): Promise<StoredSwapView>;
  /** Buy `target` with the private balance C already holds; nothing is sent from Monad. */
  startPayout(target: string, gateway: string): Promise<StoredSwapView>;
  /** Temporary: finish Fusion buys for allocated recipients still holding USDG. */
  startRecovery(target: string, gateway: string): Promise<StoredSwapView>;
  resumeSwap(gateway: string): Promise<StoredSwapView>;
  getSwapStatus(gateway: string): Promise<StoredSwapView>;
  cancelSwap(gateway: string): Promise<StoredSwapView>;
  lock(): void;
}
