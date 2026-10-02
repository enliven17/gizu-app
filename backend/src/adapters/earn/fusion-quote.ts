import { Address, Quote, QuoterRequest, PresetEnum, FusionOrder } from "@1inch/fusion-sdk";
import type { QuoterResponse } from "@1inch/fusion-sdk";
import { MakerTraits } from "@1inch/limit-order-sdk";
import { getAddress } from "viem";
import type { Address as EvmAddress } from "viem";
import { randomBytes } from "node:crypto";
import { ETHEREUM_PROFILE } from "./vault.ts";
import { resolverBudget } from "./policy.ts";
import type { ResolverEconomics } from "./policy.ts";
export type FusionProposal = {
  input: bigint;
  minimumEth: bigint;
  grossEth: bigint;
  economics: ResolverEconomics;
  quotedAtMs: number;
  expiresAtMs: number;
  quoteId: string | null;
  orderHash: string;
  priceUsdcPerEth: bigint;
  deadline: bigint;
  unsignedOrder?: Record<string, string>;
  extension?: string;
};
type Response = QuoterResponse & {
  gas?: unknown;
  gasLimit?: unknown;
  quoteGeneratedAt: unknown;
  feeToken?: unknown;
  blockNumber?: unknown;
};
const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
/** SDK construction creates an UNSIGNED proposal. No permits, signing interfaces, or submission APIs are used here. */
export function validateFusionResponse(
  response: Response,
  {
    owner,
    input,
    expectedEnd,
    nowMs = Date.now(),
    permit,
    deadline,
    enableEstimate=false,
  }: { owner: EvmAddress; input: bigint; expectedEnd: bigint; nowMs?: number;permit?:string;enableEstimate?:boolean;deadline?:bigint },
) {
  const generated = Number(response.quoteGeneratedAt);
  if (
    !Number.isSafeInteger(generated) ||
    nowMs - generated > 60000 ||
    generated - nowMs > 5000
  )
    throw new Error("Fusion quote is stale");
  if (
    response.integratorFee !== 0 ||
    response.integratorFeeShare !== 0 ||
    response.surplusFee !== 0
  )
    throw new Error("Unapproved Fusion fee");
  if (
    !eq(response.settlementAddress, ETHEREUM_PROFILE.settlement) ||
    !eq(response.fee.receiver, ETHEREUM_PROFILE.resolverFeeReceiver) ||
    response.fee.bps < 0 ||
    response.fee.bps > 10000 ||
    !Number.isInteger(response.fee.bps) ||
    !Number.isFinite(response.fee.whitelistDiscountPercent) ||
    response.fee.whitelistDiscountPercent < 0 ||
    response.fee.whitelistDiscountPercent > 100
  )
    throw new Error("Unapproved settlement fee semantics");
  if (
    response.feeToken !== undefined &&
    response.feeToken !== ETHEREUM_PROFILE.nativeToken
  )
    throw new Error("Changed native fee token");
  if (BigInt(response.fromTokenAmount) !== input)
    throw new Error("Fusion input changed");
  const p = response.presets.custom;
  if (
    !p ||
    p.allowPartialFills !== false ||
    p.allowMultipleFills !== false ||
    BigInt(p.auctionEndAmount) !== expectedEnd ||
    BigInt(p.auctionStartAmount) !== expectedEnd ||
    p.initialRateBump !== 0 ||
    p.points.length !== 0 ||
    p.auctionDuration !== 180 ||
    p.startAuctionIn < 0 ||
    p.startAuctionIn > 120 ||
    BigInt(p.bankFee) !== 0n
  )
    throw new Error("Changed custom full-fill auction");
  const params = {
    fromTokenAddress: ETHEREUM_PROFILE.usdc,
    toTokenAddress: ETHEREUM_PROFILE.nativeToken,
    amount: input.toString(),
    walletAddress: getAddress(owner),
    enableEstimate,
    ...(permit?{permit}:{}),
  };
  const quote = new Quote(QuoterRequest.new(params), response);
  let order = quote.createFusionOrder({
    network: 1,
    preset: PresetEnum.custom,
    receiver: new Address(owner),
    nonce: BigInt("0x" + randomBytes(5).toString("hex")),
    orderExpirationDelay:60n,
  });
  if(deadline!==undefined){
    if(deadline<order.auctionEndTime)throw new Error("Saved permit cannot cover the new auction");
    const built=order.build();
    order=FusionOrder.fromDataAndExtension({...built,makerTraits:new MakerTraits(BigInt(built.makerTraits)).withExpiration(deadline).asBigInt().toString()},order.extension);
    if(order.deadline!==deadline)throw new Error("Saved permit deadline changed");
  }
  const built = order.build(),
    traits = new MakerTraits(BigInt(built.makerTraits));
  if (
    !eq(order.maker.toString(), owner) ||
    !eq(order.realReceiver.toString(), owner) ||
    !eq(order.makerAsset.toString(), ETHEREUM_PROFILE.usdc) ||
    !eq(order.takerAsset.toString(), ETHEREUM_PROFILE.weth) ||
    order.makingAmount !== input ||
    order.partialFillAllowed ||
    order.multipleFillsAllowed ||
    !traits.isNativeUnwrapEnabled()
  )
    throw new Error("Changed Fusion native owner/token semantics");
  if (
    order.deadline <= BigInt(Math.floor(nowMs / 1000)) ||
    order.deadline > BigInt(Math.floor(nowMs / 1000) + 600)
  )
    throw new Error("Unbounded Fusion deadline");
  if (!quote.whitelist.length || quote.whitelist.length > 100)
    throw new Error("Missing resolver whitelist");
  const net = quote.whitelist.map((r) =>
      order.getUserReceiveAmount(r, input, order.auctionEndTime, 0n),
    ),
    gross = quote.whitelist.map((r) =>
      order.calcTakingAmount(r, input, order.auctionEndTime, 0n),
    );
  if (net.some((n) => n <= 0n) || gross.some((n) => n < 0n))
    throw new Error("Invalid native output");
  return {
    minimumEth: net.reduce((a, b) => (a < b ? a : b)),
    grossEth: gross.reduce((a, b) => (a > b ? a : b)),
    orderHash: order.getOrderHash(1),
    unsignedOrder: { ...built } as Record<string, string>,
    extension: order.extension.encode(),
    deadlineMs: Number(order.deadline) * 1000,
  };
}
export class FusionQuoteProvider {
  constructor(
    private apiKey: string,
    private fetcher: typeof fetch = fetch,
    private now: () => number = Date.now,
  ) {}
  async quote(
    owner: EvmAddress,
    input: bigint,
    gasPrice: bigint,
    options:{permit?:string;enableEstimate?:boolean;deadline?:bigint}={},
  ): Promise<FusionProposal> {
    if (!this.apiKey || input <= 0n || (options.permit&&!/^0x[0-9a-f]{448}$/i.test(options.permit)))
      throw new Error("Fusion provider unavailable");
    const query = new URLSearchParams({
      fromTokenAddress: ETHEREUM_PROFILE.usdc,
      toTokenAddress: ETHEREUM_PROFILE.nativeToken,
      amount: input.toString(),
      walletAddress: owner,
      enableEstimate: String(options.enableEstimate===true),
      ...(options.permit?{permit:options.permit}:{}),
      surplus: "true",
    });
    const receive = async (customPreset?: unknown): Promise<Response> => {
      const res = await this.fetcher(
        `https://api.1inch.com/fusion/quoter/v2.0/1/quote/receive/?${query}`,
        {
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
          },
          ...(customPreset
            ? { method: "POST", body: JSON.stringify(customPreset) }
            : {}),
          signal: AbortSignal.timeout(12000),
        },
      );
      if (!res.ok) {
        if (res.status === 400) {
          const body: unknown = await res.json();
          if (
            body &&
            typeof body === "object" &&
            "description" in body &&
            String(body.description).toLowerCase() === "insufficient amount"
          )
            throw Object.assign(new Error("Fusion amount too small"), {
              code: "FUSION_AMOUNT_TOO_SMALL",
            });
        }
        throw new Error("Fusion quote unavailable");
      }
      const text = await res.text();
      if (text.length > 250000) throw new Error("Unbounded provider response");
      return JSON.parse(text) as Response;
    };
    const initial = await receive(),
      budget = resolverBudget(initial, input, gasPrice),
      bps = BigInt(initial.fee.bps);
    if (bps < 0n || bps > 10000n) throw new Error("Invalid protocol fee");
    const end = (budget.maximumGrossEth * 9950n) / (10000n + bps) - 2n;
    if (end <= 0n)
      throw Object.assign(new Error("Fusion amount too small"), {
        code: "FUSION_AMOUNT_TOO_SMALL",
      });
    const response = await receive({
      auctionDuration: 180,
      auctionStartAmount: end.toString(),
      auctionEndAmount: end.toString(),
      points: [],
      allowPartialFills: false,
      allowMultipleFills: false,
    });
    const validated = validateFusionResponse(response, {
        owner,
        input,
        expectedEnd: end,
        nowMs: this.now(),
        permit:options.permit,
        deadline:options.deadline,
        enableEstimate:options.enableEstimate,
      }),
      economics = resolverBudget(response, input, gasPrice);
    if (
      economics.inputValueWei - validated.grossEth - economics.gasCostWei <
      economics.profitWei
    )
      throw new Error("Resolver compensation changed");
    return {
      input,
      minimumEth: validated.minimumEth,
      grossEth: validated.grossEth,
      economics,
      quotedAtMs: Number(response.quoteGeneratedAt),
      expiresAtMs: Math.min(
        Number(response.quoteGeneratedAt) + 60000,
        validated.deadlineMs,
      ),
      quoteId: response.quoteId,
      orderHash: validated.orderHash,
      unsignedOrder: validated.unsignedOrder,
      extension: validated.extension,
      priceUsdcPerEth: (input * 10n ** 18n) / economics.inputValueWei,
      deadline:BigInt(Math.floor(validated.deadlineMs/1000)),
    };
  }
  async price(owner: EvmAddress, gasPrice: bigint): Promise<bigint> {
    const input = 1000000n,
      query = new URLSearchParams({
        fromTokenAddress: ETHEREUM_PROFILE.usdc,
        toTokenAddress: ETHEREUM_PROFILE.nativeToken,
        amount: String(input),
        walletAddress: owner,
        enableEstimate: "false",
        surplus: "true",
      });
    const res = await this.fetcher(
      `https://api.1inch.com/fusion/quoter/v2.0/1/quote/receive/?${query}`,
      {
        headers: { authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!res.ok) throw new Error("Native price unavailable");
    const body = (await res.json()) as Response;
    const generated = Number(body.quoteGeneratedAt);
    if (
      !Number.isSafeInteger(generated) ||
      this.now() - generated > 60000 ||
      generated - this.now() > 5000 ||
      BigInt(body.fromTokenAmount) !== input
    )
      throw new Error("Stale or changed provider price");
    const economics = resolverBudget(body, input, gasPrice);
    if (economics.inputValueWei <= 0n) throw new Error("Invalid native price");
    return (input * 10n ** 18n) / economics.inputValueWei;
  }
}
