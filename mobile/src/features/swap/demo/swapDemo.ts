import type { CatalogToken, TokenCatalogService } from "@/domain/tokenCatalog";
import type {
  MainnetPortfolioSnapshot,
  StoredSwapView,
  SwapHoldingsSnapshot,
} from "@/domain/wallet/storedSigner";
import type { StoredSwapBridge } from "@/services/wallet/nativeBridge";

/**
 * Swap demo mode (`EXPO_PUBLIC_SWAP_DEMO=1`). Every swap flow runs against this in-memory
 * simulation instead of the native signer: no network, no funds, no passkey. It follows the real
 * rules (wallet count by amount, 70-130% shares, pooled sells) so a demo shows what users get.
 */
export function swapDemoEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SWAP_DEMO === "1";
}

const USDC = 1_000_000n;
const TOKEN = 10n ** 18n;
const STARTING_USDC = 250n * USDC;
const FUNDING_ADDRESS = "0x5a1F3c9E0b7D4e2C8f6A1b3D5e7F9a0B2c4D6e8F";

type DemoToken = CatalogToken & { priceCents: number };
const stock = (address: string, symbol: string, name: string, priceCents: number): DemoToken => ({
  chainId: 4663,
  address,
  symbol,
  name,
  decimals: 18,
  logoURI: null,
  category: "rwa",
  issuer: "Robinhood",
  swapListed: true,
  fusionStatus: "quote-required",
  priceCents,
});
export const demoTokens: DemoToken[] = [
  stock("0x12f190a9F9d7D37a250758b26824B97CE941bF54", "AMZN", "Amazon", 23_000),
  stock("0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", "AAPL", "Apple", 33_800),
  stock("0x3b8E2a7C6d1F0e9A4c5B7d2E8f1A3c6B9d0E2f4A", "TSLA", "Tesla", 42_000),
  stock("0x7c4D9e1A2b6F3a8C0d5E7b9F1a4C6e8B0d2F3a5C", "NVDA", "NVIDIA", 18_000),
  stock("0x9e1B3d5F7a0C2e4B6d8F0a2C4e6B8d0F1a3C5e7B", "GOOGL", "Alphabet", 25_000),
  stock("0x2d4F6a8C0e1B3d5F7a9C1e3B5d7F9a0C2e4B6d8F", "MSFT", "Microsoft", 51_000),
  stock("0x6f8A0c2E4b6D8f0A1c3E5b7D9f1A3c5E7b9D0f2A", "COIN", "Coinbase", 33_000),
];
const tokenOf = (address: string) =>
  demoTokens.find((token) => token.address.toLowerCase() === address.toLowerCase());

/** Tokens a USDC budget buys at the demo price, less a 0.3% route cost. */
export function demoQuoteOut(target: string, usdcAtoms: bigint): bigint {
  const token = tokenOf(target);
  if (!token || usdcAtoms <= 0n) return 0n;
  return (usdcAtoms * TOKEN * 100n * 997n) / (BigInt(token.priceCents) * USDC * 1000n);
}

/** USDC atoms a sale returns at the demo price, less a 0.5% route cost. */
export function demoSaleOut(target: string, tokenAtoms: bigint): bigint {
  const token = tokenOf(target);
  if (!token) return 0n;
  return (tokenAtoms * BigInt(token.priceCents) * USDC * 995n) / (TOKEN * 100n * 1000n);
}

/** The engine's rule: wallet count by amount, then shares within 70-130% of an equal share. */
export function demoLegs(
  usdcAtoms: bigint,
  random: () => number = Math.random,
): { count: number; weights: number[] } {
  const usdc = Number(usdcAtoms) / 1e6;
  const counts =
    usdc < 5 ? [1] : usdc <= 20 ? [2] : usdc <= 100 ? [2, 3] : usdc <= 1000 ? [3, 4] : [4, 5];
  const count = counts[Math.floor(random() * counts.length)] ?? counts[0]!;
  if (count === 1) return { count, weights: [10_000] };
  const low = Math.ceil(7_000 / count);
  const high = Math.floor(13_000 / count);
  const weights = Array.from(
    { length: count },
    () => low + Math.floor(random() * (high - low + 1)),
  );
  let sum = weights.reduce((a, b) => a + b, 0);
  while (sum !== 10_000) {
    const grow = sum < 10_000;
    const open = weights.flatMap((w, i) => ((grow ? w < high : w > low) ? [i] : []));
    const pick = open[Math.floor(random() * open.length)] ?? open[0]!;
    const room = grow ? high - weights[pick]! : weights[pick]! - low;
    const step = Math.min(room, Math.abs(10_000 - sum));
    weights[pick] = weights[pick]! + (grow ? step : -step);
    sum = weights.reduce((a, b) => a + b, 0);
  }
  return { count, weights };
}

const split = (total: bigint, weights: number[]) => {
  let used = 0n;
  return weights.map((w, i) => {
    const part = i === weights.length - 1 ? total - used : (total * BigInt(w)) / 10_000n;
    used += part;
    return part;
  });
};

const freshAddress = () =>
  "0x" +
  Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");

export type DemoReview = {
  direction: "buy" | "sell";
  symbol: string;
  headline: string;
  flow: string;
  facts: { label: string; value: string }[];
  legs: { title: string; address: string; detail: string }[];
};

export type DemoSheet =
  | { mode: "review"; review: DemoReview }
  | { mode: "authorizing" }
  | { mode: "progress" }
  | { mode: "done" }
  | null;

type Step = { phase: string; step: string; ms: number; apply?: () => void };
type Run = {
  view: StoredSwapView;
  review: DemoReview;
  steps: Step[];
  index: number;
  timer: ReturnType<typeof setTimeout> | null;
  finish: () => void;
  /** The bridge call waiting for this screen to close, as the native screen does. */
  settle: ((view: StoredSwapView) => void) | null;
};
type Holding = { atoms: bigint; wallets: string[] };

type HistoryRow = MainnetPortfolioSnapshot["history"][number];
const state = {
  usdcAtoms: STARTING_USDC,
  holdings: new Map<string, Holding>(),
  history: [] as HistoryRow[],
  status: null as StoredSwapView | null,
  sheet: null as DemoSheet,
  run: null as Run | null,
};
const listeners = new Set<() => void>();
let version = 0;
const emit = () => {
  version++;
  listeners.forEach((listener) => listener());
};

export const swapDemo = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  version: () => version,
  sheet: () => state.sheet,
  status: () => state.status,
  usdcAtoms: () => state.usdcAtoms,
  /** Back to a fresh wallet; tests and the demo's own reset use it. */
  reset(usdcAtoms: bigint = STARTING_USDC) {
    if (state.run?.timer) clearTimeout(state.run.timer);
    state.usdcAtoms = usdcAtoms;
    state.holdings.clear();
    state.history = [];
    state.status = null;
    state.sheet = null;
    state.run = null;
    emit();
  },
  approve() {
    const run = state.run;
    if (!run || state.sheet?.mode !== "review") return;
    state.sheet = { mode: "authorizing" };
    emit();
    // A short pause stands in for the passkey confirmation.
    run.timer = setTimeout(() => {
      run.view = { ...run.view, approved: true };
      state.status = run.view;
      state.sheet = { mode: "progress" };
      emit();
      advance(run);
    }, 900);
  },
  /** Cancel before approval: nothing moved. */
  cancelReview() {
    const run = state.run;
    if (!run || state.sheet?.mode !== "review") return;
    state.run = null;
    state.status = { ...run.view, phase: "CANCELLED", step: "review" };
    state.sheet = null;
    emit();
    run.settle?.(state.status);
  },
  /** The swap keeps running; only the screen goes away. */
  continueInBackground() {
    const run = state.run;
    state.sheet = null;
    emit();
    if (run) {
      run.settle?.(run.view);
      run.settle = null;
    }
  },
  /** Close the result screen. */
  dismiss() {
    state.sheet = null;
    emit();
  },
};

function advance(run: Run) {
  if (state.run !== run) return;
  const step = run.steps[run.index];
  if (!step) {
    run.finish();
    state.run = null;
    state.status = { ...run.view, phase: "COMPLETE", step: "done" };
    state.history = [
      {
        operationId: run.view.operationId,
        phase: "COMPLETE",
        direction: run.view.direction,
        symbol: run.view.targetSymbol,
        receivedAtoms:
          run.view.direction === "buy" ? run.view.receivedTargetAtoms : run.view.creditedAtoms,
        recordedAt: Date.now(),
      },
      ...state.history,
    ].slice(0, 50);
    if (state.sheet?.mode === "progress") state.sheet = { mode: "done" };
    emit();
    run.settle?.(state.status);
    run.settle = null;
    return;
  }
  run.view = { ...run.view, phase: step.phase, step: step.step };
  step.apply?.();
  state.status = run.view;
  emit();
  run.index++;
  run.timer = setTimeout(() => advance(run), step.ms);
}

function begin(view: StoredSwapView, review: DemoReview, steps: Step[], finish: () => void) {
  if (state.run) return Promise.reject(new Error("A demo swap is already running."));
  return new Promise<StoredSwapView>((resolve) => {
    state.run = { view, review, steps, index: 0, timer: null, finish, settle: resolve };
    state.sheet = { mode: "review", review };
    emit();
  });
}

const usdc = (atoms: bigint) => {
  const whole = atoms / USDC;
  const fraction = (atoms % USDC).toString().padStart(6, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction.slice(0, 6)}` : ""}`;
};
const tokens = (atoms: bigint) => {
  const whole = atoms / TOKEN;
  const fraction = (atoms % TOKEN).toString().padStart(18, "0").slice(0, 6).replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
};
const percent = (weights: number[]) => weights.map((w) => Math.round(w / 100)).join("/");

function baseView(
  direction: "buy" | "sell",
  symbol: string,
  legs: number,
  holders: number,
): StoredSwapView {
  return {
    operationId: `demo-${Date.now()}`,
    phase: "REVIEW",
    step: "review",
    pausedCode: null,
    targetSymbol: symbol,
    targetDecimals: 18,
    sourceAtoms: "0",
    creditedAtoms: "0",
    payoutsSubmitted: 0,
    ordersComplete: 0,
    receivedTargetAtoms: "0",
    fundingAddress: FUNDING_ADDRESS,
    direction,
    approved: false,
    returnAddresses: [],
    legs,
    holders,
    kind: direction === "buy" ? "confidentialSwap" : "confidentialSell",
  };
}

function buy(target: string, amountAtoms: string): Promise<StoredSwapView> {
  const token = tokenOf(target);
  const budget = BigInt(amountAtoms);
  if (!token) return Promise.reject(new Error("This token is not part of the demo."));
  if (budget > state.usdcAtoms)
    return Promise.reject(
      new Error(
        "Not enough USDC in accounts large enough to fund this swap. Choose a smaller amount.",
      ),
    );
  const fee = 3_000n;
  const credit = ((budget - fee) * 999n) / 1000n;
  const { count, weights } = demoLegs(budget);
  const portions = split(credit, weights);
  const wallets = Array.from({ length: count }, freshAddress);
  const bought = portions.map((p) => demoQuoteOut(target, p));
  const total = bought.reduce((a, b) => a + b, 0n);
  const view = { ...baseView("buy", token.symbol, count, count), sourceAtoms: budget.toString() };
  const review: DemoReview = {
    direction: "buy",
    symbol: token.symbol,
    headline: "CONFIDENTIAL SWAP · MAINNET",
    flow: `Monad USDC → confidential balance → Robinhood USDG → ${token.symbol}`,
    facts: [
      { label: "You pay", value: `${usdc(budget)} USDC` },
      { label: "Network fee (paid in USDC)", value: `at most ${usdc(fee)} USDC` },
      { label: "Private credit", value: `about ${usdc(credit)} USDC` },
      { label: "You receive", value: `about ${tokens(total)} ${token.symbol}` },
      {
        label: "Spread across",
        value: `${count} fresh wallet${count === 1 ? "" : "s"} (${percent(weights)})`,
      },
    ],
    legs: wallets.map((address, i) => ({
      title: `Payout ${i + 1} of ${count}`,
      address,
      detail: `${usdc(portions[i]!)} USDC → about ${tokens(bought[i]!)} ${token.symbol}`,
    })),
  };
  const steps: Step[] = [
    { phase: "FUNDING", step: "fundingSign", ms: 500 },
    { phase: "FUNDING", step: "fundingSubmit", ms: 500 },
    { phase: "FUNDING", step: "fundingReceipt", ms: 1_000 },
    { phase: "FUNDING", step: "credit", ms: 3_000, apply: () => (state.usdcAtoms -= budget) },
    {
      phase: "CREDITED",
      step: "balances",
      ms: 600,
      apply: () => (state.run!.view = { ...state.run!.view, creditedAtoms: credit.toString() }),
    },
  ];
  wallets.forEach((_, i) =>
    steps.push(
      { phase: "PAYOUTS", step: "payoutQuote", ms: 400 },
      {
        phase: "PAYOUTS",
        step: "payoutSubmit",
        ms: 500,
        apply: () => (state.run!.view = { ...state.run!.view, payoutsSubmitted: i + 1 }),
      },
    ),
  );
  steps.push({ phase: "PAYOUTS", step: "payoutStatus", ms: 1_500 });
  wallets.forEach((_, i) =>
    steps.push(
      { phase: "FUSION", step: "fusionPreview", ms: 500 },
      { phase: "FUSION", step: "fusionSign", ms: 500 },
      { phase: "FUSION", step: "fusionStatus", ms: 1_200 },
      {
        phase: "FUSION",
        step: "fusionAfter",
        ms: 300,
        apply: () => {
          const before = BigInt(state.run!.view.receivedTargetAtoms);
          state.run!.view = {
            ...state.run!.view,
            ordersComplete: i + 1,
            receivedTargetAtoms: (before + bought[i]!).toString(),
          };
        },
      },
    ),
  );
  return begin(view, review, steps, () => {
    const held = state.holdings.get(token.address) ?? { atoms: 0n, wallets: [] };
    state.holdings.set(token.address, {
      atoms: held.atoms + total,
      wallets: [...held.wallets, ...wallets],
    });
  });
}

function sell(target: string): Promise<StoredSwapView> {
  const token = tokenOf(target);
  const held = token && state.holdings.get(token.address);
  if (!token || !held || held.atoms === 0n)
    return Promise.reject(new Error("No demo holdings to sell."));
  const proceeds = demoSaleOut(target, held.atoms);
  const { count, weights } = demoLegs(proceeds);
  const payouts = split((proceeds * 998n) / 1000n, weights);
  const returns = Array.from({ length: count }, freshAddress);
  const holders = held.wallets.length;
  const view = {
    ...baseView("sell", token.symbol, count, holders),
    returnAddresses: returns,
  };
  const review: DemoReview = {
    direction: "sell",
    symbol: token.symbol,
    headline: "CONFIDENTIAL SELL · MAINNET",
    flow: `${token.symbol} → USDG (Fusion) → confidential balance → ${count} new Monad USDC wallet${count === 1 ? "" : "s"}`,
    facts: [
      { label: "You sell", value: `${tokens(held.atoms)} ${token.symbol}` },
      { label: "From", value: `${holders} wallet${holders === 1 ? "" : "s"}` },
      { label: "Expected", value: `about ${usdc(proceeds)} USDC before payout fees` },
      {
        label: "Paid out to",
        value: `${count} fresh wallet${count === 1 ? "" : "s"} (${percent(weights)})`,
      },
    ],
    legs: returns.map((address, i) => ({
      title: `Payout ${i + 1} of ${count}`,
      address,
      detail: `about ${usdc(payouts[i]!)} USDC on Monad`,
    })),
  };
  const steps: Step[] = [];
  held.wallets.forEach((_, i) =>
    steps.push(
      { phase: "FUSION", step: "fusionPreview", ms: 500 },
      { phase: "FUSION", step: "sellQuote", ms: 500 },
      { phase: "FUSION", step: "fusionSign", ms: 500 },
      { phase: "FUSION", step: "fusionStatus", ms: 1_200 },
      {
        phase: "FUNDING",
        step: "credit",
        ms: 2_000,
        apply: () => (state.run!.view = { ...state.run!.view, ordersComplete: i + 1 }),
      },
    ),
  );
  steps.push({
    phase: "CREDITED",
    step: "balances",
    ms: 600,
    apply: () => (state.run!.view = { ...state.run!.view, creditedAtoms: proceeds.toString() }),
  });
  returns.forEach((_, i) =>
    steps.push(
      { phase: "PAYOUTS", step: "payoutQuote", ms: 400 },
      {
        phase: "PAYOUTS",
        step: "payoutSubmit",
        ms: 500,
        apply: () => (state.run!.view = { ...state.run!.view, payoutsSubmitted: i + 1 }),
      },
    ),
  );
  steps.push({ phase: "PAYOUTS", step: "payoutStatus", ms: 1_500 });
  return begin(view, review, steps, () => {
    state.holdings.delete(token.address);
    state.usdcAtoms += payouts.reduce((a, b) => a + b, 0n);
  });
}

function holdingsSnapshot(): SwapHoldingsSnapshot {
  return {
    checkedAt: Date.now(),
    block: "demo",
    holdings: [...state.holdings.entries()]
      .filter(([, h]) => h.atoms > 0n)
      .map(([address, h]) => ({
        token: address.toLowerCase(),
        chainId: 4663 as const,
        symbol: tokenOf(address)?.symbol ?? "TOKEN",
        decimals: 18,
        balanceAtoms: h.atoms.toString(),
        batches: [{ id: `${address.toLowerCase()}:demo`, balanceAtoms: h.atoms.toString() }],
      })),
  };
}

/** A token amount's value at the demo price, in USDC atoms. */
export function demoValue(target: string, tokenAtoms: bigint): bigint {
  const token = tokenOf(target);
  return token ? (tokenAtoms * BigInt(token.priceCents) * USDC) / (TOKEN * 100n) : 0n;
}

/**
 * Home's portfolio in demo mode, built from the simulated swaps: Total balance is the demo USDC
 * balance (it falls on a buy and rises on a sell) and every bought stock appears under Tokens and
 * vault positions with its demo value. It passes the same validation as a native snapshot.
 */
export function demoPortfolioSnapshot(walletId: string, address: string): MainnetPortfolioSnapshot {
  const now = Date.now();
  const ownedAssets = [...state.holdings.entries()]
    .filter(([, held]) => held.atoms > 0n)
    .map(([token, held]) => ({
      assetId: `4663:${token.toLowerCase()}`,
      chainId: 4663,
      token: token.toLowerCase(),
      symbol: tokenOf(token)?.symbol ?? "TOKEN",
      decimals: 18,
      balanceAtoms: held.atoms.toString(),
      observedAtoms: held.atoms.toString(),
      complete: true,
      stale: false,
      checkedAt: now,
      valueUsdcAtoms: demoValue(token, held.atoms).toString(),
      valuationUnavailable: false,
    }));
  return {
    walletId,
    chainId: 143,
    asset: "USDC",
    decimals: 6,
    fundingAddress: address,
    fundingAtoms: state.usdcAtoms.toString(),
    returnAtoms: "0",
    totalAtoms: state.usdcAtoms.toString(),
    checkedAt: now,
    block: "demo",
    balanceComplete: true,
    stale: false,
    syncPending: false,
    confidentialReadState: "ready",
    ownedAssets,
    positions: [],
    valuationComplete: true,
    ownedBalanceComplete: true,
    ownedStale: false,
    ownedSyncPending: false,
    ownedCheckedAt: now,
    accounts: [
      { address, accountIndex: 1, role: "funding", balanceAtoms: state.usdcAtoms.toString() },
    ],
    history: state.history,
  };
}

const notInDemo = () => Promise.reject(new Error("Not part of the swap demo."));

/** Stands in for the native swap bridge while demo mode is on. */
export const demoSwapBridge: StoredSwapBridge = {
  getSwapDeposit: async () => ({ fundingAddress: FUNDING_ADDRESS }),
  getSwapStatus: async () => state.status ?? { phase: "NONE" },
  getSwapHoldings: async () => holdingsSnapshot(),
  startSwap: (target, amountAtoms) => buy(target, amountAtoms),
  sellSwapHolding: (holdingId) => sell(holdingId.split(":")[0] ?? ""),
  startSell: () => {
    const last = [...state.holdings.keys()].pop();
    return last ? sell(last) : notInDemo();
  },
  resumeSwap: () => {
    const run = state.run;
    if (!run) return Promise.resolve(state.status ?? swapDemoIdle());
    return new Promise<StoredSwapView>((resolve) => {
      run.settle = resolve;
      state.sheet = run.view.approved
        ? { mode: "progress" }
        : { mode: "review", review: run.review };
      emit();
    });
  },
  cancelSwap: async () => {
    if (state.run?.view.approved) throw new Error("This demo swap is already running.");
    swapDemo.cancelReview();
    return state.status ?? swapDemoIdle();
  },
  startPayout: notInDemo,
  startRecovery: notInDemo,
  sweepSwapHolding: notInDemo,
  getMainnetPortfolio: notInDemo,
  lock: async () => {},
};

function swapDemoIdle(): StoredSwapView {
  return { ...baseView("buy", "", 1, 1), phase: "CANCELLED" };
}

/** The demo's token catalog: Robinhood stock tokens with fixed prices. */
export const demoCatalogService: TokenCatalogService = {
  async list(query) {
    const search = query.search.trim().toLowerCase();
    const list = demoTokens
      .filter((token) => query.chainId === null || token.chainId === query.chainId)
      .filter((token) => query.category === "all" || token.category === query.category)
      .filter((token) => `${token.symbol} ${token.name}`.toLowerCase().includes(search))
      .map(({ priceCents: _price, ...token }) => token);
    return { list, page: query.page, items: 20, total: list.length };
  },
};
