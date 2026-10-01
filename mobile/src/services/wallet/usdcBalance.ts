import type { WalletBalanceService } from "./balance";
import { monadUsdc } from "@/domain/wallet/assets";

function result(rows: unknown[], id: number): unknown {
  const matches = rows.filter(
    (row): row is Record<string, unknown> =>
      !!row && typeof row === "object" && "id" in row && row.id === id,
  );
  const row = matches[0];
  if (matches.length !== 1 || !row || row.jsonrpc !== "2.0" || "error" in row)
    throw new Error("Invalid USDC response");
  return row.result;
}

function uint256(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value))
    throw new Error("Invalid ERC-20 result");
  return BigInt(value);
}

export const monadUsdcBalanceService: WalletBalanceService = {
  async getBalance(address, signal) {
    if (!/^0x[0-9a-f]{40}$/i.test(address)) throw new Error("Invalid address");
    if (signal.aborted) throw new Error("Balance request aborted");
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort);
    const timeout = setTimeout(abort, 12_000);
    const call = (data: string) => [{ to: monadUsdc.contract, data }, "latest"];
    try {
      const response = await fetch(monadUsdc.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          { jsonrpc: "2.0", id: 2, method: "eth_getCode", params: [monadUsdc.contract, "latest"] },
          { jsonrpc: "2.0", id: 3, method: "eth_call", params: call("0x313ce567") },
          {
            jsonrpc: "2.0",
            id: 4,
            method: "eth_call",
            params: call("0x70a08231" + address.slice(2).padStart(64, "0")),
          },
        ]),
      });
      if (!response.ok) throw new Error("USDC balance unavailable");
      const rows: unknown = await response.json();
      if (controller.signal.aborted) throw new Error("Balance request aborted");
      if (!Array.isArray(rows) || rows.length !== 4) throw new Error("Invalid USDC response");
      if (result(rows, 1) !== "0x8f") throw new Error("Wrong Monad network");
      const code = result(rows, 2);
      if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code))
        throw new Error("USDC contract unavailable");
      if (uint256(result(rows, 3)) !== BigInt(monadUsdc.decimals))
        throw new Error("Unexpected USDC decimals");
      return uint256(result(rows, 4)).toString();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  },
};
