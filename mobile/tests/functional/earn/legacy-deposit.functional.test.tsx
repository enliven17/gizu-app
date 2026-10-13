import { render, screen, userEvent } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { EarnProvider } from "@/features/earn/EarnProvider";
import { LegacyEthereumDepositScreen } from "@/features/earn/LegacyEthereumDepositScreen";
import { hoodIntent } from "../../support/robinhoodEarn";
import { mainnetPortfolio } from "../../support/mainnetWallet";
const Stack = createNativeStackNavigator();
const intent = {
  ...hoodIntent,
  profileId: "ethereum-usdc" as const,
  destinations: hoodIntent.destinations.map((d) => ({
    ...d,
    chainId: 1,
  })) as typeof hoodIntent.destinations,
};
function setup(enabled = true) {
  let funded = false,
    paid = 0,
    filled = false,
    invested = false;
  const funding = {
    operationId: "source_1",
    walletId: intent.walletId,
    kind: "sourceFunding",
    status: "credited",
    blocked: false,
    creditedAtoms: "2970000",
    sourceAccountIndex: 1,
  };
  const source = {
    available: jest.fn().mockResolvedValue(enabled),
    list: jest.fn().mockImplementation(async () => (funded ? [funding] : [])),
    planMany: jest.fn().mockResolvedValue([{ budget: "3000000", expiresAtMs: Date.now() + 45000 }]),
    executeMany: jest.fn().mockImplementation(async () => {
      funded = true;
      return [funding];
    }),
    plan: jest.fn(),
    execute: jest.fn(),
    resume: jest.fn(),
    reconcileCredit: jest.fn(),
    cancelUnsigned: jest.fn(),
    cancel: jest.fn(),
  };
  const payout = {
    available: jest.fn().mockResolvedValue(enabled),
    list: jest
      .fn()
      .mockImplementation(async () =>
        ["hold", "invest"]
          .slice(0, paid)
          .map((leg) => ({ sourceOperationId: "source_1", leg, status: "paid" })),
      ),
    execute: jest.fn().mockImplementation(async () => {
      paid++;
    }),
    resume: jest.fn(),
    reconcile: jest.fn(),
    cancelUnsigned: jest.fn(),
    cancel: jest.fn(),
  };
  const liquidity = {
    available: jest.fn().mockResolvedValue(enabled),
    list: jest
      .fn()
      .mockImplementation(async () =>
        filled ? [{ kind: "fusionEthOrder", status: "fusionFilled" }] : [],
      ),
    bootstrap: jest.fn().mockResolvedValue({
      proposal: { kind: "fusionEthOrder", inputAtoms: "100000" },
      expiresAtMs: Date.now() + 45000,
    }),
    execute: jest.fn().mockImplementation(async () => {
      filled = true;
    }),
    resume: jest.fn(),
    returnPlan: jest.fn(),
    reconcileCredit: jest.fn(),
    cancelUnsigned: jest.fn(),
    cancelPending: jest.fn(),
    cancel: jest.fn(),
  };
  const vault = {
    available: jest.fn().mockResolvedValue(enabled),
    list: jest.fn().mockImplementation(async () => (invested ? [{ status: "invested" }] : [])),
    plan: jest.fn().mockImplementation(async () => ({
      amountAtoms: "2500000",
      fusionRequired: !filled,
      maximumGasCostWei: "100",
      withdrawalReserveWei: "200",
      expiresAtMs: Date.now() + 45000,
    })),
    execute: jest.fn().mockImplementation(async () => {
      invested = true;
    }),
    resume: jest.fn(),
    cancelUnsigned: jest.fn(),
    cancel: jest.fn(),
  };
  render(
    <MainnetWalletProvider
      session={{
        kind: "mainnet",
        walletId: intent.walletId,
        address: intent.sourceAddress,
        accountId: intent.sourceAddress,
        accountIndex: 1,
        method: "Passkey",
        chainId: 143,
      }}
      service={{
        getMainnetPortfolio: jest
          .fn()
          .mockResolvedValue(mainnetPortfolio(intent.walletId, intent.sourceAddress)),
      }}
    >
      <EarnProvider
        service={{
          load: jest.fn().mockResolvedValue(intent),
          prepare: jest.fn(),
          cancel: jest.fn(),
        }}
        sourceFunding={source}
        payout={payout}
        liquidity={liquidity}
        vaultExecution={vault}
      >
        <NavigationContainer>
          <Stack.Navigator>
            <Stack.Screen name="Deposit">
              {() => <LegacyEthereumDepositScreen intent={intent} />}
            </Stack.Screen>
          </Stack.Navigator>
        </NavigationContainer>
      </EarnProvider>
    </MainnetWalletProvider>,
  );
  return { source, payout, liquidity, vault };
}
test("Ethereum reuses funding, payout, liquidity and vault services in order and stops invested", async () => {
  const { source, payout, liquidity, vault } = setup();
  const user = userEvent.setup();
  expect(await screen.findByText(/separate native approvals/)).toBeVisible();
  await user.type(screen.getByLabelText("USDC deposit amount"), "3");
  await user.press(screen.getByRole("button", { name: "Review USDC funding" }));
  expect(source.planMany).toHaveBeenCalledWith(
    intent,
    "3000000",
    expect.stringMatching(/^[0-9]+$/),
    expect.anything(),
  );
  await user.press(await screen.findByRole("button", { name: "Authorize USDC funding" }));
  expect(vault.plan).not.toHaveBeenCalled();
  await user.press(
    await screen.findByRole("button", { name: "Review and authorize 10% hold payout" }),
  );
  await user.press(
    await screen.findByRole("button", { name: "Review and authorize 90% investment payout" }),
  );
  expect(payout.execute).toHaveBeenNthCalledWith(
    1,
    intent,
    expect.objectContaining({ operationId: "source_1" }),
    "hold",
  );
  expect(payout.execute).toHaveBeenNthCalledWith(
    2,
    intent,
    expect.objectContaining({ operationId: "source_1" }),
    "invest",
  );
  await user.press(await screen.findByRole("button", { name: "Review vault deposit" }));
  await user.press(await screen.findByRole("button", { name: "Authorize ETH funding" }));
  expect(vault.execute).not.toHaveBeenCalled();
  await user.press(await screen.findByRole("button", { name: "Review vault deposit" }));
  await user.press(await screen.findByRole("button", { name: "Authorize vault deposit" }));
  expect(await screen.findByText("Invested")).toBeVisible();
  expect(liquidity.execute).toHaveBeenCalledTimes(1);
  expect(vault.execute).toHaveBeenCalledTimes(1);
  expect(vault.plan.mock.calls.every((call) => call[1] === "vaultDeposit")).toBe(true);
  expect(liquidity.returnPlan).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Withdraw/i })).toBeNull();
});
test("an unsupported Ethereum signer never receives a Robinhood coordinator substitute", async () => {
  const { source, vault } = setup(false);
  expect(
    await screen.findByText("This build does not support native Ethereum deposits."),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Review USDC funding" })).toBeDisabled();
  expect(source.planMany).not.toHaveBeenCalled();
  expect(vault.execute).not.toHaveBeenCalled();
});
