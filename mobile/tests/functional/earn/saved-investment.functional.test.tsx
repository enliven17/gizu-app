import { render, screen, userEvent } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { EarnProvider } from "@/features/earn/EarnProvider";
import { EarnInvestmentScreen } from "@/features/earn/EarnInvestmentScreen";
import { hoodIntent } from "../../support/robinhoodEarn";
import { mainnetPortfolio } from "../../support/mainnetWallet";
import { depositSnapshot } from "../../support/depositJourney";
import type { RootStackParamList } from "@/navigation/types";
const Stack = createNativeStackNavigator<RootStackParamList>();
function setup(foreign = false) {
  const wallet = { ...hoodIntent, ...(foreign ? { walletId: "other" } : {}) };
  const select = jest.fn().mockResolvedValue(wallet);
  const deposit = {
    available: jest.fn().mockResolvedValue(true),
    prepare: jest.fn(),
    confirm: jest.fn(),
    resume: jest.fn(),
    cancel: jest
      .fn()
      .mockResolvedValue({ ...depositSnapshot(), phase: "paused", pauseReason: "cancelled" }),
    status: jest.fn().mockResolvedValue({
      ...depositSnapshot(),
      phase: "paused",
      pauseReason: "approvalExpired",
      completedSteps: ["funding", "credit"],
      creditedAtoms: "2970000",
    }),
  };
  render(
    <MainnetWalletProvider
      session={{
        kind: "mainnet",
        walletId: hoodIntent.walletId,
        address: hoodIntent.sourceAddress,
        accountId: hoodIntent.sourceAddress,
        accountIndex: 1,
        method: "Passkey",
        chainId: 143,
      }}
      service={{
        getMainnetPortfolio: jest
          .fn()
          .mockResolvedValue(mainnetPortfolio(hoodIntent.walletId, hoodIntent.sourceAddress)),
      }}
    >
      <EarnProvider
        service={{
          load: jest.fn().mockResolvedValue(wallet),
          list: jest.fn().mockResolvedValue([wallet]),
          select,
          prepare: jest.fn(),
          cancel: jest.fn(),
        }}
        depositJourney={deposit}
      >
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen
              name="EarnInvestment"
              component={EarnInvestmentScreen}
              initialParams={{ intentId: hoodIntent.intentId }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </EarnProvider>
    </MainnetWalletProvider>,
  );
  return { select, deposit };
}
test("saved investment opens its existing native deposit and leaves withdrawal separate", async () => {
  const { deposit } = setup();
  await userEvent.press(await screen.findByRole("button", { name: "Open saved deposit progress" }));
  expect(await screen.findByText(/Approval ended/)).toBeVisible();
  expect(deposit.status).toHaveBeenCalledWith(
    expect.objectContaining({ walletId: hoodIntent.walletId }),
    "intent:" + hoodIntent.intentId,
  );
  expect(deposit.prepare).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Withdraw/i })).toBeNull();
});
test("a foreign wallet cycle is never selected or shown as an available investment", async () => {
  const { select, deposit } = setup(true);
  expect(await screen.findByText(/unavailable for the current wallet/)).toBeVisible();
  expect(select).not.toHaveBeenCalled();
  expect(deposit.status).not.toHaveBeenCalled();
});

test("saved investment offers funding recovery without a new funding amount or review", async () => {
  setup();
  await screen.findByRole("button", { name: "Open saved deposit progress" });
  expect(screen.queryByLabelText("USDC funding budget") === null).toBe(true);
  expect(screen.queryByRole("button", { name: "Review USDC funding" }) === null).toBe(true);
  expect(screen.getByRole("button", { name: "Check saved funding" })).toBeVisible();
});
