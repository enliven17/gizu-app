import { parseNativeStatus, walletAddressPattern } from "@/domain/wallet/transfers";
import type { WalletHistory, WalletTransfer } from "@/domain/wallet/types";
export function walletHistory(value: string, address: string): WalletHistory {
  if (!walletAddressPattern.test(address)) throw new Error("Invalid wallet");
  const statuses = parseNativeStatus(value);
  const rows = JSON.parse(value) as Record<string, unknown>[];
  const entries: WalletTransfer[] = [];
  const hashes = new Set<string>();
  rows.forEach((row, index) => {
    if (
      typeof row.from !== "string" ||
      !walletAddressPattern.test(row.from) ||
      row.chainId !== 10143 ||
      typeof row.nonce !== "string" ||
      !/^(?:0|[1-9][0-9]{0,19})$/.test(row.nonce)
    )
      throw new Error("Invalid journal");
    const status = statuses[index];
    if (!status) throw new Error("Missing journal status");
    if (hashes.has(status.transactionHash.toLowerCase()))
      throw new Error("Duplicate journal entry");
    hashes.add(status.transactionHash.toLowerCase());
    if (row.from.toLowerCase() !== address.toLowerCase()) return;
    const entry: WalletTransfer = { ...status, nonce: row.nonce };
    // Existing records predate detail storage. Never invent their amounts/recipients.
    if (row.to !== undefined || row.valueWei !== undefined) {
      if (
        typeof row.to !== "string" ||
        !walletAddressPattern.test(row.to) ||
        typeof row.valueWei !== "string" ||
        !/^[1-9][0-9]{0,17}$/.test(row.valueWei)
      )
        throw new Error("Invalid transfer details");
      entry.to = row.to;
      entry.valueWei = row.valueWei;
    }
    entries.push(entry);
  });
  return {
    entries: entries.reverse(),
    // Native signing conservatively blocks while ANY local operation is unresolved.
    blocked: statuses.some((row) => row.status === "pending" || row.status === "unknown"),
  };
}
