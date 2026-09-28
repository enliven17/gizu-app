export interface NativeWalletBridge {
  openWallet(): Promise<unknown>;
  lock(): void;
}
export type NativeTransfers = {
  executeOperation(proposal: string): Promise<string>;
  getOperationStatus(): Promise<string>;
  cancelOperation(): void;
};
export type NativeSignerBridge = NativeWalletBridge & NativeTransfers;

/** Public results only. Keys, PRF and authorization remain inside the native module. */
export function getNativeSigner(): NativeSignerBridge | null {
  // Retained harness only. Re-enabling the old native module requires an explicit rebuild.
  return null;
}
