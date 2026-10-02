import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";
const profiles = {
  "ethereum-usdc": { chainId: 1, rpc: "https://ethereum-rpc.publicnode.com", token: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", vault: "0x55C1B6e461a6334B567bAF0FEb5D728715446f05" },
  "robinhood-usdg": { chainId: 4663, rpc: "https://rpc.mainnet.chain.robinhood.com", token: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168", vault: "0xBeEff033F34C046626B8D0A041844C5d1A5409dd" },
} as const;
export type PreflightProfile = keyof typeof profiles;
export type EarnPreflightResult = {
  profileId: PreflightProfile; chainId: 1 | 4663; owner: string; token: string; vault: string;
  tokenDecimals: 6; blockNumber: string; blockHash: string; timestampMs: number;
  tokenBalance: string; nativeBalance: string; shares: string; newCycleReady: boolean;
  blockGas: { baseFee: string; gasUsed: string; gasLimit: string };
  feeHistoryReward: string[] | null;
  readOnly: true; executionAvailable: false; simulationAvailable: false;
};
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed RPC object");
  return value as Record<string, unknown>;
}
function hex(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value) || value.length > 66) throw new Error("Malformed RPC quantity");
  return BigInt(value);
}
function word(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]{64}$/i.test(value)) throw new Error("Malformed ABI result");
  return BigInt(value);
}
type RpcCall = { method: string; params: unknown[] };
/** Unsigned, read-only readiness. It deliberately cannot price future redemption
 * without post-deposit simulation and cannot produce a signing proposal. */
export class EarnPreflight {
  constructor(private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}
  private async rpc(url: string, calls: RpcCall[]): Promise<unknown[]> {
    const response = await this.fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(calls.map((call, i) => ({ ...call, id: i + 1, jsonrpc: "2.0" }))), signal: AbortSignal.timeout(12000) });
    if (!response.ok) throw new Error("RPC unavailable");
    const body: unknown = await response.json();
    if (!Array.isArray(body) || body.length !== calls.length) throw new Error("Malformed RPC batch");
    return calls.map((_, i) => {
      const matches = body.filter(row => row && typeof row === "object" && row.id === i + 1);
      if (matches.length !== 1) throw new Error("Duplicate or missing RPC result");
      const row = record(matches[0]);
      if (row.jsonrpc !== "2.0" || "error" in row || !("result" in row)) throw new Error("Invalid RPC response");
      return row.result;
    });
  }
  async check(profileId: PreflightProfile, owner: string): Promise<EarnPreflightResult> {
    if (!Object.hasOwn(profiles, profileId) || !/^0x[0-9a-f]{40}$/i.test(owner) || /^0x0{40}$/i.test(owner)) throw new InfrastructureError(400, "INVALID_EARN_OWNER", "A supported profile and destination wallet are required.");
    const profile = profiles[profileId];
    try {
      const [chain, rawBlock] = await this.rpc(profile.rpc, [{ method: "eth_chainId", params: [] }, { method: "eth_getBlockByNumber", params: ["latest", false] }]);
      if (hex(chain) !== BigInt(profile.chainId)) throw new Error("Chain changed");
      const block = record(rawBlock);
      const number = hex(block.number), timestamp = hex(block.timestamp);
      const timestampMs = Number(timestamp) * 1000, now = this.now();
      if (!Number.isSafeInteger(timestampMs) || !Number.isSafeInteger(now) || now - timestampMs > 60000 || timestampMs - now > 5000) throw new Error("Stale block");
      const baseFee = hex(block.baseFeePerGas), gasUsed = hex(block.gasUsed), gasLimit = hex(block.gasLimit);
      if (gasLimit < 2n || gasUsed > gasLimit) throw new Error("Invalid block gas");
      const blockHash = block.hash;
      if (typeof blockHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(blockHash) || /^0x0{64}$/i.test(blockHash)) throw new Error("Invalid block hash");
      // EIP-1898: a number alone may identify another fork between RPC batches.
      const ref = { blockHash, requireCanonical: true };
      const call = (to: string, data: string): RpcCall => ({ method: "eth_call", params: [{ to, data }, ref] });
      const balanceOf = "0x70a08231" + owner.slice(2).padStart(64,"0");
      const calls: RpcCall[] = [
        { method: "eth_getCode", params: [profile.token, ref] },
        { method: "eth_getCode", params: [profile.vault, ref] },
        call(profile.token, "0x313ce567"), call(profile.vault, "0x38d52e0f"),
        call(profile.token, balanceOf), call(profile.vault, balanceOf),
        { method: "eth_getBalance", params: [owner, ref] },
      ];
      if (profile.chainId === 1) calls.push({ method: "eth_feeHistory", params: ["0x8", block.number, [25]] });
      const values = await this.rpc(profile.rpc, calls);
      for (const code of values.slice(0,2)) if (typeof code !== "string" || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) throw new Error("Missing contract code");
      if (word(values[2]) !== 6n || word(values[3]) !== BigInt(profile.token)) throw new Error("Token or vault asset changed");
      const tokenBalance = word(values[4]), shares = word(values[5]), nativeBalance = hex(values[6]);
      let feeHistoryReward: string[] | null = null;
      if (profile.chainId === 1) {
        const history = record(values[7]);
        if (number < 7n || hex(history.oldestBlock) !== number - 7n || !Array.isArray(history.reward) || history.reward.length !== 8 || !Array.isArray(history.baseFeePerGas) || history.baseFeePerGas.length !== 9 || !Array.isArray(history.gasUsedRatio) || history.gasUsedRatio.length !== 8) throw new Error("Fee history reference changed");
        const fees = history.baseFeePerGas.map(hex);
        const target = gasLimit / 2n;
        const diff = baseFee * (gasUsed > target ? gasUsed-target : target-gasUsed) / target / 8n;
        const next = gasUsed === target ? baseFee : gasUsed < target ? baseFee - diff : baseFee + (diff > 0n ? diff : 1n);
        if (fees[7] !== baseFee || fees[8] !== next || history.gasUsedRatio.some(r => typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1)) throw new Error("Fee history disagreement");
        feeHistoryReward = history.reward.map(row => { if (!Array.isArray(row) || row.length !== 1) throw new Error("Invalid fee sample"); return hex(row[0]).toString(); });
      }
      const [rawCanonical] = await this.rpc(profile.rpc, [{ method: "eth_getBlockByNumber", params: [block.number, false] }]);
      const canonical = record(rawCanonical);
      if (canonical.hash !== blockHash || canonical.number !== block.number || canonical.timestamp !== block.timestamp || canonical.baseFeePerGas !== block.baseFeePerGas || canonical.gasUsed !== block.gasUsed || canonical.gasLimit !== block.gasLimit) throw new Error("Reference block changed");
      if (this.now() - timestampMs > 60000) throw new Error("Readiness expired during sampling");
      return { profileId, chainId: profile.chainId, owner, token: profile.token, vault: profile.vault, tokenDecimals: 6, blockNumber: number.toString(), blockHash, timestampMs, tokenBalance: tokenBalance.toString(), nativeBalance: nativeBalance.toString(), shares: shares.toString(), newCycleReady: shares === 0n && (profile.chainId === 1 || nativeBalance === 0n), blockGas: { baseFee: baseFee.toString(), gasUsed: gasUsed.toString(), gasLimit: gasLimit.toString() }, feeHistoryReward, readOnly: true, executionAvailable: false, simulationAvailable: false };
    } catch {
      // Do not return raw provider responses, endpoint credentials or exception URLs.
      throw new InfrastructureError(502, "EARN_PREFLIGHT_UNAVAILABLE", "Could not verify fresh chain, token and vault state. Execution remains unavailable.");
    }
  }
}
