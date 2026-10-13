import { act, render, screen } from "@testing-library/react-native";
import { Text } from "react-native";
import {
  MainnetWalletProvider,
  useMainnetWallet,
  validateMainnetPortfolio,
} from "@/features/wallet/MainnetWalletProvider";
import { demoPortfolioSnapshot, demoSwapBridge, swapDemo } from "@/features/swap/demo/swapDemo";
import type { MainnetWalletSession } from "@/services/access";

jest.mock("@/services/wallet/nativeBridge", () => ({
  getStoredSwapSigner: jest.fn(() => {
    throw new Error("the demo used the native signer");
  }),
}));

const AMZN = "0x12f190a9F9d7D37a250758b26824B97CE941bF54";
const session: MainnetWalletSession = {
  kind: "mainnet",
  method: "Passkey",
  accountId: "demo",
  address: "0x" + "1".repeat(40),
  accountIndex: 1,
  chainId: 143,
  walletId: "7aafcc2e-0891-4e31-a7d4-03780d7b4f12",
};

/** What Home reads: Total balance and each Tokens and vault positions row. */
function HomeProbe() {
  const { snapshot } = useMainnetWallet();
  if (!snapshot) return null;
  return (
    <>
      <Text>{`total ${snapshot.totalAtoms}`}</Text>
      {snapshot.ownedAssets?.map((asset) => (
        <Text
          key={asset.assetId}
        >{`${asset.symbol} ${asset.balanceAtoms} worth ${asset.valueUsdcAtoms}`}</Text>
      ))}
      <Text>{`history ${snapshot.history.map((h) => `${h.direction}:${h.symbol}`).join(",")}`}</Text>
    </>
  );
}

async function complete(start: Promise<unknown>) {
  let settled = false;
  void start.then(() => (settled = true));
  await act(async () => {
    swapDemo.approve();
    for (let i = 0; i < 80 && !settled; i++) await jest.advanceTimersByTimeAsync(1_000);
  });
  await act(async () => swapDemo.dismiss());
  expect(settled).toBe(true);
}

beforeEach(() => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
  jest.useFakeTimers();
  swapDemo.reset();
});
afterEach(() => {
  swapDemo.reset();
  jest.useRealTimers();
  delete process.env.EXPO_PUBLIC_SWAP_DEMO;
});

test("Home's total balance and positions follow the demo buys and sells", async () => {
  render(
    <MainnetWalletProvider session={session}>
      <HomeProbe />
    </MainnetWalletProvider>,
  );
  expect(await screen.findByText("total 250000000")).toBeVisible();
  expect(screen.queryByText(/^AMZN /)).toBeNull();

  await complete(demoSwapBridge.startSwap(AMZN, "30000000", ""));
  // Total balance is the demo USDC balance; the stock appears with its value.
  expect(await screen.findByText("total 220000000")).toBeVisible();
  const row = await screen.findByText(/^AMZN \d+ worth \d+$/);
  const value = Number(String(row.props.children).split(" worth ")[1]) / 1e6;
  expect(value).toBeGreaterThan(29);
  expect(value).toBeLessThan(30);
  expect(screen.getByText("history buy:AMZN")).toBeVisible();

  await complete(demoSwapBridge.sellSwapHolding(`${AMZN.toLowerCase()}:demo`, ""));
  expect(screen.queryByText(/^AMZN /)).toBeNull();
  expect(screen.getByText("history sell:AMZN,buy:AMZN")).toBeVisible();
  const total = Number(swapDemo.usdcAtoms()) / 1e6;
  expect(total).toBeGreaterThan(249);
  expect(screen.getByText(`total ${swapDemo.usdcAtoms()}`)).toBeVisible();
});

test("the demo snapshot passes the same validation as a native one", async () => {
  await complete(demoSwapBridge.startSwap(AMZN, "30000000", ""));
  const snapshot = demoPortfolioSnapshot(session.walletId!, session.address);
  expect(() => validateMainnetPortfolio(snapshot, session.walletId)).not.toThrow();
  expect(snapshot.ownedAssets).toHaveLength(1);
});
