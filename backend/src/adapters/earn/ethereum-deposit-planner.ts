import {
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  parseAbi,
  keccak256,
  stringToHex,
} from "viem";
import type { Address, PublicClient } from "viem";
import { mainnet } from "viem/chains";
import { InfrastructureError } from "../../domain/errors/infrastructure-error.ts";
import {
  POLICY_VERSION,
  ceilDiv,
  feePolicy,
  gasBudget,
  nextBaseFee,
  selectBootstrapQuote,
} from "./policy.ts";
import type { Fees, ReferenceBlock } from "./policy.ts";
import { ETHEREUM_PROFILE, balance } from "./vault.ts";
import { simulateDeposit } from "./fork-simulation.ts";
import type { DepositSimulation } from "./fork-simulation.ts";
import { FusionQuoteProvider } from "./fusion-quote.ts";
import type { FusionProposal } from "./fusion-quote.ts";
export type EthereumPlanRequest = {
  owner: string;
  operationId: string;
  revision: number;
  existingSharesScope?: "include-existing";
};
export type EthereumPlannerConfig = {
  rpcUrl: string;
  oneInchApiKey?: string;
  anvilPath?: string;
  timeoutMs?: number;
};
export type EthereumState = {
  block: ReferenceBlock;
  owner: string;
  usdc: bigint;
  eth: bigint;
  weth: bigint;
  shares: bigint;
  nonce: bigint;
  usdcAllowance: bigint;
  shareAllowance: bigint;
  ownerCode: string;
  shareDecimals: number;
  tips: bigint[];
};
export type EthereumPlannerProviders = {
  readState: (owner: Address) => Promise<EthereumState>;
  assertFresh: (state: EthereumState, fees: Fees) => Promise<void>;
  simulate: (
    state: EthereumState,
    amount: bigint,
  ) => Promise<DepositSimulation>;
  price?: (owner: Address, fee: bigint) => Promise<bigint>;
  quote?: (
    input: bigint,
    owner: Address,
    fee: bigint,
  ) => Promise<FusionProposal>;
};
export type EthereumDepositPlan = {
  operationId: string;
  revision: number;
  policyVersion: typeof POLICY_VERSION;
  profileId: "ethereum-usdc";
  chainId: 1;
  owner: string;
  vault: string;
  router: string;
  assets: {
    usdc: { address: string; decimals: 6 };
    native: { symbol: "ETH"; decimals: 18 };
    weth: { address: string; decimals: 18 };
    shares: { address: string; decimals: number };
  };
  referenceBlockNumber: string;
  referenceBlockHash: string;
  referenceTimestampMs: number;
  quotedAtMs: number;
  expiresAtMs: number;
  planHash: string;
  startingBalances: {
    usdc: string;
    nativeEth: string;
    weth: string;
    shares: string;
  };
  allowances: { usdc: string; shares: string };
  nonce: string;
  accountCode: string;
  existingSharesScope: "new-position" | "include-existing";
  depositAmount: string;
  previewShares: string;
  maxSharePrice: string;
  deadline: string;
  retainedLiquidUsdc: string;
  depositGasBudgetWei: string;
  withdrawalReserveWei: string;
  totalBudgetWei: string;
  extraUsableEthWei: string;
  fees: {
    baseFeeWei: string;
    priorityFeeWei: string;
    maximumDepositFeeWei: string;
    withdrawalReserveFeeWei: string;
    sampleBlocks: 8;
    percentile: 25;
    aggregation: "upper-median";
    depositHeadroomBps: 1000;
    withdrawalHeadroomBps: 3000;
    withdrawalPriceMultiplier: 2;
  };
  simulation: {
    deposit: {
      to: string;
      data: string;
      estimatedGas: string;
      actualGas: string;
      gasLimit: string;
    }[];
    withdrawal: {
      to: string;
      data: string;
      estimatedGas: string;
      actualGas: string;
      gasLimit: string;
    }[];
    postDepositShares: string;
    withdrawalPurpose: "reserve-only-isolated-fork";
    fundingAssumption: "real-USDC-balance-with-fork-only-native-gas-override";
  };
  fusion: null | {
    inputUsdc: string;
    minimumNativeEthWei: string;
    grossNativeEthWei: string;
    embeddedOverheadWei: string;
    quoteId: string | null;
    orderHash: string;
    quotedAtMs: number;
    expiresAtMs: number;
    unsignedOrder: Record<string, string> | null;
    extension: string | null;
    economics: Record<string, string>;
  };
  exclusions: string[];
  readOnly: true;
  simulationAvailable: true;
  executionAvailable: false;
};
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const v of Object.values(value)) freeze(v);
  }
  return value;
}
function fail(code: string, message: string): never {
  throw new InfrastructureError(409, code, message);
}
const vaultReadAbi = parseAbi(["function asset() view returns(address)"]);
export async function readEthereumState(
  client: PublicClient,
  owner: Address,
  now: () => number = Date.now,
): Promise<EthereumState> {
  if ((await client.getChainId()) !== 1)
    throw new Error("Wrong Ethereum chain");
  const block = await client.getBlock();
  if (
    !block.hash ||
    !/^0x[0-9a-f]{64}$/i.test(block.hash) ||
    /^0x0{64}$/i.test(block.hash) ||
    block.baseFeePerGas === null ||
    block.number < 7n ||
    now() - Number(block.timestamp) * 1000 > 60000 ||
    Number(block.timestamp) * 1000 - now() > 5000
  )
    throw new Error("Stale Ethereum reference");
  const args = { blockNumber: block.number };
  const [
    tokenCode,
    vaultCode,
    routerCode,
    decimals,
    asset,
    usdc,
    shares,
    eth,
    weth,
    nonce,
    usdcAllowance,
    shareAllowance,
    ownerCode,
    shareDecimals,
    history,
  ] = await Promise.all([
    client.getCode({ address: ETHEREUM_PROFILE.usdc, ...args }),
    client.getCode({ address: ETHEREUM_PROFILE.vault, ...args }),
    client.getCode({ address: ETHEREUM_PROFILE.router, ...args }),
    client.readContract({
      address: ETHEREUM_PROFILE.usdc,
      abi: erc20Abi,
      functionName: "decimals",
      ...args,
    }),
    client.readContract({
      address: ETHEREUM_PROFILE.vault,
      abi: vaultReadAbi,
      functionName: "asset",
      ...args,
    }),
    balance(client, ETHEREUM_PROFILE.usdc, owner, block.number),
    balance(client, ETHEREUM_PROFILE.vault, owner, block.number),
    client.getBalance({ address: owner, ...args }),
    balance(client, ETHEREUM_PROFILE.weth, owner, block.number),
    client.getTransactionCount({ address: owner, ...args }),
    client.readContract({
      address: ETHEREUM_PROFILE.usdc,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, ETHEREUM_PROFILE.router],
      ...args,
    }),
    client.readContract({
      address: ETHEREUM_PROFILE.vault,
      abi: erc20Abi,
      functionName: "allowance",
      args: [owner, ETHEREUM_PROFILE.router],
      ...args,
    }),
    client.getCode({ address: owner, ...args }),
    client.readContract({
      address: ETHEREUM_PROFILE.vault,
      abi: erc20Abi,
      functionName: "decimals",
      ...args,
    }),
    client.getFeeHistory({
      blockCount: 8,
      blockNumber: block.number,
      rewardPercentiles: [25],
    }),
  ]);
  if (
    [tokenCode, vaultCode, routerCode].some(
      (code) => !code || !/^0x(?:[0-9a-f]{2})+$/i.test(code),
    ) ||
    decimals !== 6 ||
    asset.toLowerCase() !== ETHEREUM_PROFILE.usdc.toLowerCase() ||
    (ownerCode && ownerCode !== "0x")
  )
    throw new Error("Unsupported account or vault code");
  const reference = {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp,
    baseFeePerGas: block.baseFeePerGas,
    gasUsed: block.gasUsed,
    gasLimit: block.gasLimit,
  };
  if (
    history.oldestBlock !== block.number - 7n ||
    history.reward?.length !== 8 ||
    history.gasUsedRatio.length !== 8 ||
    history.gasUsedRatio.some((r) => !Number.isFinite(r) || r < 0 || r > 1) ||
    history.reward.some((row) => row.length !== 1 || row[0]! < 0n) ||
    history.baseFeePerGas.length !== 9 ||
    history.baseFeePerGas[7] !== block.baseFeePerGas ||
    history.baseFeePerGas[8] !== nextBaseFee(reference)
  )
    throw new Error("Invalid fee history binding");
  if (
    (await client.getBlock({ blockNumber: block.number })).hash !== block.hash
  )
    throw new Error("Reference reorg");
  return {
    block: reference,
    owner,
    usdc,
    shares,
    eth,
    weth,
    nonce: BigInt(nonce),
    usdcAllowance,
    shareAllowance,
    ownerCode: ownerCode ?? "0x",
    shareDecimals,
    tips: history.reward.map((row) => row[0]!),
  };
}
export class EthereumDepositPlanner {
  private providers: EthereumPlannerProviders;
  constructor(
    private config: EthereumPlannerConfig,
    providers?: EthereumPlannerProviders,
    private now: () => number = Date.now,
  ) {
    if (providers) {
      this.providers = providers;
      return;
    }
    const client = createPublicClient({
      chain: mainnet,
      transport: http(config.rpcUrl, { retryCount: 0, timeout: 12000 }),
      cacheTime: 0,
    });
    const fusion = new FusionQuoteProvider(
      config.oneInchApiKey ?? "",
      fetch,
      now,
    );
    this.providers = {
      readState: (owner) => readEthereumState(client, owner, now),
      simulate: (state, amount) => {
        if (!config.anvilPath)
          throw new Error("Fork simulation is not configured");
        return simulateDeposit({
          rpcUrl: config.rpcUrl,
          anvilPath: config.anvilPath,
          timeoutMs: config.timeoutMs,
          block: state.block,
          owner: getAddress(state.owner),
          amount,
          initialShares: state.shares,
        });
      },
      price: (owner, fee) => fusion.price(owner, fee),
      quote: (input, owner, fee) => fusion.quote(owner, input, fee),
      assertFresh: async (state, fees) => {
        const fresh = await readEthereumState(
          client,
          getAddress(state.owner),
          now,
        );
        if (
          fresh.block.number > state.block.number + 1n ||
          (await client.getBlock({ blockNumber: state.block.number })).hash !==
            state.block.hash ||
          nextBaseFee(fresh.block) + fees.priorityFee > fees.depositFee ||
          now() - Number(state.block.timestamp) * 1000 > 60000 ||
          [
            "usdc",
            "eth",
            "weth",
            "shares",
            "nonce",
            "usdcAllowance",
            "shareAllowance",
          ].some(
            (k) =>
              fresh[k as keyof EthereumState] !==
              state[k as keyof EthereumState],
          )
        )
          throw new Error("State or fee changed during planning");
      },
    };
  }
  async plan(request: EthereumPlanRequest): Promise<EthereumDepositPlan> {
    if (
      !/^0x[0-9a-f]{40}$/i.test(request.owner) ||
      /^0x0{40}$/i.test(request.owner) ||
      !Number.isSafeInteger(request.revision) ||
      request.revision < 1 ||
      !/^[-a-zA-Z0-9_]{1,128}$/.test(request.operationId)
    )
      throw new InfrastructureError(
        400,
        "INVALID_EARN_PLAN_REQUEST",
        "A destination owner, operation ID and positive revision are required.",
      );
    try {
      const owner = getAddress(request.owner),
        state = await this.providers.readState(owner),
        fees = feePolicy(state.block, state.tips);
      if (
        state.owner.toLowerCase() !== owner.toLowerCase() ||
        state.ownerCode !== "0x" ||
        this.now() - Number(state.block.timestamp) * 1000 > 60000 ||
        Number(state.block.timestamp) * 1000 - this.now() > 5000
      )
        throw new Error("Invalid state binding");
      if (state.usdc <= 50000n)
        fail(
          "EARN_PREFUNDING_REQUIRED",
          "A confirmed Ethereum USDC payout above the temporary 0.05 USDC liquid amount is required before a deposit plan can be simulated.",
        );
      if (state.weth !== 0n)
        fail(
          "EARN_WETH_RECONCILIATION_REQUIRED",
          "Reconcile the destination WETH balance before planning native ETH funding.",
        );
      if (
        state.shares !== 0n &&
        request.existingSharesScope !== "include-existing"
      )
        fail(
          "EARN_EXISTING_SHARES_SCOPE_REQUIRED",
          "Existing vault shares require explicit scope; reserve simulation would redeem the full position.",
        );
      let amount = state.usdc - 50000n,
        selected: FusionProposal | null = null,
        price = 0n;
      for (let i = 0; i < 5; i++) {
        if (this.now() >= Number(state.block.timestamp) * 1000 + 60000)
          throw new Error("Reference expired during funding iteration");
        const simulation = await this.providers.simulate(state, amount),
          budget = gasBudget(
            simulation.deposit.map((r) => r.estimatedGas),
            simulation.withdrawal.map((r) => r.estimatedGas),
            fees,
          ),
          shortfall = budget.totalWei - state.eth;
        if (
          (!selected && shortfall <= 0n) ||
          (selected && state.eth + selected.minimumEth >= budget.totalWei)
        ) {
          await this.providers.assertFresh(state, fees);
          const quotedAtMs = this.now();
          if (quotedAtMs >= Number(state.block.timestamp) * 1000 + 60000)
            throw new Error("Plan expired during simulation");
          if (
            selected &&
            (selected.expiresAtMs <= quotedAtMs ||
              quotedAtMs - selected.quotedAtMs > 60000 ||
              selected.quotedAtMs - quotedAtMs > 5000)
          )
            throw new Error("Fusion expired during simulation");
          const input = selected?.input ?? 0n,
            received = selected?.minimumEth ?? 0n,
            purchaseValue = selected
              ? ceilDiv(input * 10n ** 18n, selected.priceUsdcPerEth)
              : 0n,
            overhead = purchaseValue > received ? purchaseValue - received : 0n;
          const plan: EthereumDepositPlan = {
            operationId: request.operationId,
            revision: request.revision,
            policyVersion: POLICY_VERSION,
            profileId: "ethereum-usdc",
            chainId: 1,
            owner,
            vault: ETHEREUM_PROFILE.vault,
            router: ETHEREUM_PROFILE.router,
            assets: {
              usdc: { address: ETHEREUM_PROFILE.usdc, decimals: 6 },
              native: { symbol: "ETH", decimals: 18 },
              weth: { address: ETHEREUM_PROFILE.weth, decimals: 18 },
              shares: {
                address: ETHEREUM_PROFILE.vault,
                decimals: state.shareDecimals,
              },
            },
            referenceBlockNumber: String(state.block.number),
            referenceBlockHash: state.block.hash,
            referenceTimestampMs: Number(state.block.timestamp) * 1000,
            quotedAtMs,
            expiresAtMs: Math.min(
              quotedAtMs + 45000,
              Number(state.block.timestamp) * 1000 + 60000,
              selected?.expiresAtMs ?? Infinity,
            ),
            planHash: "",
            startingBalances: {
              usdc: String(state.usdc),
              nativeEth: String(state.eth),
              weth: String(state.weth),
              shares: String(state.shares),
            },
            allowances: {
              usdc: String(state.usdcAllowance),
              shares: String(state.shareAllowance),
            },
            nonce: String(state.nonce),
            accountCode: state.ownerCode,
            existingSharesScope:
              state.shares === 0n ? "new-position" : "include-existing",
            depositAmount: String(amount),
            previewShares: String(simulation.previewShares),
            maxSharePrice: String(simulation.maxSharePrice),
            deadline: String(state.block.timestamp + 600n),
            retainedLiquidUsdc: String(state.usdc - input - amount),
            depositGasBudgetWei: String(budget.depositWei),
            withdrawalReserveWei: String(budget.withdrawWei),
            totalBudgetWei: String(budget.totalWei + overhead),
            extraUsableEthWei: String(state.eth + received - budget.totalWei),
            fees: {
              baseFeeWei: String(state.block.baseFeePerGas),
              priorityFeeWei: String(fees.priorityFee),
              maximumDepositFeeWei: String(fees.depositFee),
              withdrawalReserveFeeWei: String(fees.withdrawFee),
              sampleBlocks: 8,
              percentile: 25,
              aggregation: "upper-median",
              depositHeadroomBps: 1000,
              withdrawalHeadroomBps: 3000,
              withdrawalPriceMultiplier: 2,
            },
            simulation: {
              deposit: simulation.deposit.map((r, i) => ({
                ...r,
                estimatedGas: String(r.estimatedGas),
                actualGas: String(r.actualGas),
                gasLimit: String(budget.depositLimits[i]),
              })),
              withdrawal: simulation.withdrawal.map((r, i) => ({
                ...r,
                estimatedGas: String(r.estimatedGas),
                actualGas: String(r.actualGas),
                gasLimit: String(budget.withdrawLimits[i]),
              })),
              postDepositShares: String(simulation.postDepositShares),
              withdrawalPurpose: "reserve-only-isolated-fork",
              fundingAssumption:
                "real-USDC-balance-with-fork-only-native-gas-override",
            },
            fusion: selected
              ? {
                  inputUsdc: String(selected.input),
                  minimumNativeEthWei: String(selected.minimumEth),
                  grossNativeEthWei: String(selected.grossEth),
                  embeddedOverheadWei: String(overhead),
                  quoteId: selected.quoteId,
                  orderHash: selected.orderHash,
                  quotedAtMs: selected.quotedAtMs,
                  expiresAtMs: selected.expiresAtMs,
                  unsignedOrder: selected.unsignedOrder ?? null,
                  extension: selected.extension ?? null,
                  economics: Object.fromEntries(
                    Object.entries(selected.economics).map(([k, v]) => [
                      k,
                      String(v),
                    ]),
                  ),
                }
              : null,
            exclusions: [
              "Future Aurora return fees require a separate fresh quote.",
              "Withdrawal is a separate user action; future fees and liquidity are not guaranteed.",
              "After Fusion settlement, refresh state and fees before approving deposit.",
              "Fork-only native funding measures gas and is not live funding.",
            ],
            readOnly: true,
            simulationAvailable: true,
            executionAvailable: false,
          };
          plan.planHash = keccak256(stringToHex(JSON.stringify(plan)));
          return freeze(plan);
        }
        if (!this.providers.price || !this.providers.quote)
          throw new Error("Native bootstrap quote unavailable");
        if (price === 0n)
          price = await this.providers.price(owner, fees.depositFee);
        selected = await selectBootstrapQuote({
          requiredEth: shortfall,
          maxInput: state.usdc - 50001n,
          initialInput: ceilDiv(shortfall * price, 10n ** 18n),
          quote: (input) =>
            this.providers.quote!(input, owner, fees.depositFee),
        });
        amount = state.usdc - selected.input - 50000n;
      }
      throw new Error("Deposit funding did not stabilize");
    } catch (error) {
      if (error instanceof InfrastructureError) throw error;
      throw new InfrastructureError(
        502,
        "EARN_DEPOSIT_PLAN_UNAVAILABLE",
        "Could not verify a fresh Ethereum deposit and post-deposit withdrawal simulation. Execution remains unavailable.",
      );
    }
  }
}
