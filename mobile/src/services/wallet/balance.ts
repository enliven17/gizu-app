import { AppError } from "@/domain/errors";
import { requestJson } from "../http";
export interface WalletBalanceService {
  getBalance(address: string, signal: AbortSignal): Promise<string>;
}
const endpoint = "https://testnet-rpc.monad.xyz";
export const monadBalanceService: WalletBalanceService = {
  async getBalance(address, signal) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new AppError("validation", "Invalid address");
    const rows = await requestJson(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] },
          { jsonrpc: "2.0", id: 2, method: "eth_getBalance", params: [address, "latest"] },
        ]),
      },
      "Balance unavailable",
    );
    if (!Array.isArray(rows) || rows.length !== 2) throw new AppError("invalid-response");
    const chain = rows.find((row) => row?.id === 1);
    const balance = rows.find((row) => row?.id === 2);
    if (
      chain?.jsonrpc !== "2.0" ||
      balance?.jsonrpc !== "2.0" ||
      chain.error ||
      balance.error ||
      chain.result !== "0x279f" ||
      typeof balance.result !== "string" ||
      !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(balance.result)
    )
      throw new AppError("invalid-response");
    return BigInt(balance.result).toString();
  },
};
