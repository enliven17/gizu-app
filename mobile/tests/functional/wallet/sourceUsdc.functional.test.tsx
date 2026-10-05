import { mainnetPortfolio } from "../../support/mainnetWallet";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { Linking } from "react-native";
import { AppRoot } from "@/application/AppRoot";
import { createStoredWalletAccess } from "@/services/wallet/storedAccess";
import { defaultPreferences } from "@/domain/preferences";
import { deferred } from "../../support/renderApp";

const address = "0x" + "1".repeat(40);
const walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12";
const state = {
  status: "ready",
  walletId,
  accounts: [{ accountIndex: 0, address, chainId: 10143 }],
};
beforeEach(() => jest.spyOn(Linking, "getInitialURL").mockResolvedValue(null));
afterEach(() => jest.restoreAllMocks());

function setup() {
  const native = {
    getSwapDeposit: jest.fn().mockResolvedValue({ fundingAddress: address }),
    getWalletState: jest.fn().mockResolvedValue(state),
    openWallet: jest.fn().mockResolvedValue(state),
    createWallet: jest.fn(),
    backupWallet: jest.fn(),
    restoreWallet: jest.fn(),
    lock: jest.fn(),
  };
  const balance = { getBalance: jest.fn().mockResolvedValue("19990574") };
  const transfers = {
    history: jest.fn().mockResolvedValue({ entries: [], blocked: false }),
    send: jest.fn(),
    cancel: jest.fn(),
  };
  const portfolio = {
    getMainnetPortfolio: jest.fn().mockResolvedValue(mainnetPortfolio(walletId, address)),
  };
  const clipboard = { copy: jest.fn().mockResolvedValue(undefined) };
  render(
    <AppRoot
      mainnetPortfolioService={portfolio}
      accessService={createStoredWalletAccess(() => native)}
      walletBalanceService={balance}
      walletTransferService={transfers}
      opportunityService={{
        list: jest.fn().mockResolvedValue({ list: [], page: 0, items: 8, total: 0 }),
        detail: jest.fn(),
        tvlRecords: jest.fn().mockResolvedValue([]),
      }}
      accountDependencies={{
        clipboard,
        store: {
          load: jest.fn().mockResolvedValue(defaultPreferences),
          save: jest.fn(),
          clear: jest.fn(),
        },
      }}
    />,
  );
  return { native, balance, portfolio, transfers, clipboard };
}
async function open() {
  await screen.findByRole("button", { name: "Continue with passkey" });
  await userEvent.press(screen.getByRole("button", { name: "Continue with passkey" }));
}

test("mainnet Home and Earn share the native portfolio without another source RPC", async () => {
  const { portfolio, balance, transfers } = setup();
  await open();
  expect(await screen.findByLabelText("19.990574 USDC")).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Confidential earn" }));
  expect(await screen.findByText("Source balance: 19.990574 USDC")).toBeVisible();
  expect(portfolio.getMainnetPortfolio).toHaveBeenCalled();
  expect(balance.getBalance).not.toHaveBeenCalled();
  expect(transfers.history).not.toHaveBeenCalled();
});

test("mainnet deposit keeps the explicit USDC receiving address", async () => {
  const { clipboard } = setup();
  await open();
  await screen.findByLabelText("19.990574 USDC");
  await userEvent.press(screen.getByRole("button", { name: "Deposit" }));
  expect(await screen.findByText("Monad mainnet · USDC")).toBeVisible();
  expect(
    screen.getByText("Swap funding address · Receive USDC on Monad mainnet only."),
  ).toBeVisible();
  await userEvent.press(screen.getByRole("button", { name: "Copy account address" }));
  expect(clipboard.copy).toHaveBeenCalledWith(address);
});

test("USDC withdrawal never calls the testnet transfer signer", async () => {
  const { transfers } = setup();
  await open();
  await userEvent.press(await screen.findByRole("button", { name: "Withdraw" }));
  expect(await screen.findByText(/Direct mainnet withdrawals are not available yet/)).toBeVisible();
  expect(transfers.send).not.toHaveBeenCalled();
  expect(transfers.history).not.toHaveBeenCalled();
});

test("failed native portfolio refresh preserves the prior balance until a fresh snapshot", async () => {
  const { portfolio } = setup();
  await open();
  await screen.findByLabelText("19.990574 USDC");
  portfolio.getMainnetPortfolio.mockRejectedValueOnce(new Error("Offline"));
  await userEvent.press(screen.getByRole("button", { name: "Refresh mainnet balances" }));
  expect(await screen.findByText(/Previously loaded balances may be stale/)).toBeVisible();
  expect(screen.getByLabelText("19.990574 USDC")).toBeVisible();
  portfolio.getMainnetPortfolio.mockResolvedValue(mainnetPortfolio(walletId, address, "0"));
  await userEvent.press(screen.getByRole("button", { name: "Refresh mainnet balances" }));
  expect(await screen.findByLabelText("0 USDC")).toBeVisible();
});

test("disconnect ignores late native snapshots from the previous session", async () => {
  const { portfolio, native } = setup();
  const pending = deferred<import("@/domain/wallet/storedSigner").MainnetPortfolioSnapshot>();
  portfolio.getMainnetPortfolio.mockReturnValueOnce(pending.promise);
  await open();
  await screen.findByText("Checking Monad mainnet balances…");
  await userEvent.press(screen.getByLabelText("Settings tab"));
  await userEvent.press(await screen.findByRole("button", { name: "Disconnect" }));
  await screen.findByRole("button", { name: "Continue with passkey" });
  portfolio.getMainnetPortfolio.mockResolvedValue(mainnetPortfolio(walletId, address, "0"));
  await open();
  expect(await screen.findByLabelText("0 USDC")).toBeVisible();
  await act(async () => pending.resolve(mainnetPortfolio(walletId, address, "1000000")));
  expect(screen.queryByText("1 USDC")).toBeNull();
  expect(native.lock).toHaveBeenCalled();
});

test("an incomplete native cache displays checking balances and cannot expose zero as spendable", async () => {
  const { portfolio } = setup();
  portfolio.getMainnetPortfolio.mockResolvedValue({
    ...mainnetPortfolio(walletId, address, "0"),
    balanceComplete: false,
    stale: true,
    syncPending: true,
  });
  await open();
  expect(await screen.findByText("Checking Monad mainnet balances…")).toBeVisible();
  expect(screen.queryByLabelText("0 USDC")).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Confidential earn" }));
  expect(await screen.findByText("Checking source balance…")).toBeVisible();
});

test("owned token amounts and vault underlying values remain distinct when market prices are unavailable", async () => {
  const { portfolio } = setup();
  const weth = {
    assetId: "eth:weth",
    chainId: 1,
    token: "0x" + "6".repeat(40),
    symbol: "WETH",
    decimals: 18,
    balanceAtoms: "500000000000000000",
    observedAtoms: "500000000000000000",
    complete: true,
    stale: false,
    checkedAt: Date.now(),
    valueUsdcAtoms: null,
    valuationUnavailable: true,
  };
  portfolio.getMainnetPortfolio.mockResolvedValue({
    ...mainnetPortfolio(walletId, address),
    ownedAssets: [
      weth,
      {
        ...weth,
        assetId: "hood:unknown",
        symbol: "NEW",
        decimals: null,
        balanceAtoms: null,
        observedAtoms: "0",
        complete: false,
        valuationUnavailable: false,
      },
    ],
    positions: [
      {
        ...weth,
        assetId: "eth:pendle",
        token: "0x" + "7".repeat(40),
        symbol: "USDC",
        decimals: 6,
        balanceAtoms: "2000000",
        observedAtoms: "2000000",
        shareDecimals: 18,
        conversionEstimated: true,
        shareAtoms: "1000000000000000000",
        underlyingAtoms: "2000000",
        valueUsdcAtoms: "2000000",
        valuationUnavailable: false,
      },
    ],
    ownedBalanceComplete: false,
    valuationComplete: false,
  });
  await open();
  expect(await screen.findByText("0.5 WETH")).toBeVisible();
  expect(screen.getByText("Vault position · USDC")).toBeVisible();
  expect(screen.getByText("Estimated underlying: 2 USDC")).toBeVisible();
  expect(screen.getByText("Value: 2 USDC")).toBeVisible();
  expect(screen.getByText("USDC value unavailable.")).toBeVisible();
  expect(screen.getByText("Checking NEW balance…")).toBeVisible();
  expect(
    screen.getByText(
      "Some assets have no verified USDC value. Token amounts are shown separately.",
    ),
  ).toBeVisible();
  expect(screen.getByLabelText("19.990574 USDC")).toBeVisible();
});

test("partial vault observations use underlying units and never relabel shares as USDC", async () => {
  const { portfolio } = setup();
  const position = {
    assetId: "eth:partial-vault",
    chainId: 1,
    token: "0x" + "7".repeat(40),
    symbol: "USDC",
    decimals: 6,
    balanceAtoms: null,
    observedAtoms: "1000000000000000000",
    shareAtoms: null,
    shareDecimals: 18,
    underlyingAtoms: null,
    observedUnderlyingAtoms: "2000000",
    conversionEstimated: true,
    complete: false,
    stale: true,
    checkedAt: Date.now(),
    valueUsdcAtoms: null,
    valuationUnavailable: false,
  };
  portfolio.getMainnetPortfolio.mockResolvedValue({
    ...mainnetPortfolio(walletId, address),
    positions: [
      position,
      {
        ...position,
        assetId: "hood:partial-vault",
        symbol: "USDG",
        chainId: 4663,
        observedUnderlyingAtoms: null,
      },
    ],
    ownedBalanceComplete: false,
  });
  await open();
  expect(await screen.findByText("Previously observed: 2 USDC")).toBeVisible();
  expect(screen.getByText("Checking USDC balance…")).toBeVisible();
  expect(screen.getByText("Checking USDG balance…")).toBeVisible();
  expect(screen.queryByText(/Previously observed: .*USDG/)).toBeNull();
  expect(screen.queryByText(/1,?000,?000,?000,?000 (USDC|USDG)/)).toBeNull();
  expect(screen.getByLabelText("19.990574 USDC")).toBeVisible();
});
