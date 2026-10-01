import { monadUsdcAssetId } from "./assets.ts";
import { auroraApi } from "./http.ts";
import { base58 } from "@scure/base";
import { bytesToHex, verifyMessage, type Address } from "viem";
import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";
export type ReadAuthentication = { standard: "erc191"; payload: string; signature: string };
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid response");
  return v as Record<string, unknown>;
}
function amount(v: unknown): string {
  if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 1n << 256n) throw new Error("Invalid balance");
  return v;
}
export async function authenticateEarnRead(auth: ReadAuthentication, clock: () => number = Date.now): Promise<string> {
    if (auth.standard !== "erc191" || typeof auth.payload !== "string" || auth.payload.length > 2048 || typeof auth.signature !== "string" || !/^secp256k1:[1-9A-HJ-NP-Za-km-z]{86,90}$/.test(auth.signature)) throw new Error("Invalid authentication");
    const message = record(JSON.parse(auth.payload));
    if (Object.keys(message).sort().join(",") !== "deadline,intents,nonce,signer_id,verifying_contract" || auth.payload !== JSON.stringify(Object.fromEntries(Object.keys(message).sort().map(k => [k,message[k]])))) throw new Error("Noncanonical authentication");
    const signer = message.signer_id;
    if (typeof signer !== "string" || !/^0x[0-9a-f]{40}$/.test(signer) || /^0x0{40}$/.test(signer) || message.verifying_contract !== "intents.near" || !Array.isArray(message.intents) || message.intents.length !== 0 || typeof message.nonce !== "string" || typeof message.deadline !== "string") throw new Error("Read-only authentication required");
    const nonce = Buffer.from(message.nonce,"base64");
    if (nonce.length !== 32 || nonce.toString("base64") !== message.nonce || nonce.subarray(0,5).toString("hex") !== "5628f6c600") throw new Error("Invalid nonce");
    const started = nonce.readBigUInt64LE(17), deadline = nonce.readBigUInt64LE(9), now = BigInt(clock())*1000000n;
    if (started > now || now-started > 60000000000n || deadline-started !== 300000000000n || started%1000000n !== 0n || deadline%1000000n !== 0n || new Date(Number(deadline/1000000n)).toISOString() !== message.deadline) throw new Error("Expired authentication");
    const bytes = base58.decode(auth.signature.slice(10));
    if (bytes.length !== 65 || bytes[64]! > 1) throw new Error("Invalid signature");
    bytes[64]! += 27;
    if (!await verifyMessage({address: signer as Address,message:auth.payload,signature:bytesToHex(bytes)})) throw new Error("Changed signer");
    return signer;

}
/** Aggregate private balance is authenticated, but cannot establish credit to an
 * operation. Only a separate operation-scoped settlement adapter can do that. */
export class ConfidentialBalance {
  private occupied = new Set<string>();
  constructor(private key?: string, private fetcher: typeof fetch = fetch, private now: () => number = Date.now) {}

  async read(auth: ReadAuthentication): Promise<{ confidentialAddress: string; assetId: string; available: string; timestampMs: number; authenticated: true; operationScoped: false }> {
    if (!this.key) throw new InfrastructureError(503,"EARN_AUTH_UNAVAILABLE","Confidential balance provider is not configured.");
    let signer: string;
    try { signer = await authenticateEarnRead(auth,this.now); }
    catch { throw new InfrastructureError(400,"INVALID_EARN_AUTH","A fresh native read-only authentication is required."); }
    if (this.occupied.has(signer) || this.occupied.size >= 32) throw new InfrastructureError(429,"EARN_AUTH_BUSY","Confidential balance check already in progress. Retry later.");
    this.occupied.add(signer);
    try {
      const session = await auroraApi(this.key, this.fetcher, "auth/authenticate/{key}",{signedData:auth});
      if (typeof session.accessToken !== "string" || !session.accessToken || session.accessToken.length > 8192) throw new Error("Invalid session");
      const registry = await auroraApi(this.key, this.fetcher, "tokens/{key}");
      if (!Array.isArray(registry.tokens)) throw new Error("Missing registry");
      const matches = registry.tokens.map(record).filter(t => t.blockchain === "monad" && t.symbol === "USDC" && t.decimals === 6 && typeof t.contractAddress === "string" && t.contractAddress.toLowerCase() === "0x754704bc059f8c67012fed69bc8a327a5aafb603");
      if (matches.length !== 1 || typeof matches[0]!.assetId !== "string" || matches[0]!.assetId !== monadUsdcAssetId) throw new Error("Ambiguous private asset");
      const assetId = matches[0]!.assetId;
      const response = await auroraApi(this.key, this.fetcher, `account/balances/{key}?tokenIds=${encodeURIComponent(assetId)}`,undefined,session.accessToken);
      if (!Array.isArray(response.balances) || response.balances.length > 1) throw new Error("Ambiguous balance");
      const balance = response.balances[0] === undefined ? null : record(response.balances[0]);
      if (balance && (balance.source !== "private" || balance.tokenId !== assetId)) throw new Error("Wrong private balance");
      return {confidentialAddress:signer,assetId,available:balance ? amount(balance.available) : "0",timestampMs:this.now(),authenticated:true,operationScoped:false};
    } catch {
      // No session token, raw provider response, signed payload or key-bearing URL in errors.
      throw new InfrastructureError(502,"EARN_PRIVATE_BALANCE_UNAVAILABLE","Could not verify the confidential USDC balance. No settlement is confirmed.");
    } finally { this.occupied.delete(signer); }
  }
}
