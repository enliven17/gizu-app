import { fireEvent, render, screen } from "@testing-library/react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { EarnProvider } from "@/features/earn/EarnProvider";
import { EarnInvestmentScreen } from "@/features/earn/EarnInvestmentScreen";
import { VaultWithdrawScreen } from "@/features/earn/VaultWithdrawScreen";
import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import { earnProfiles, type EarnIntent } from "@/domain/earn/types";
import type { RootStackParamList } from "@/navigation/types";
import { hoodIntent } from "../../support/robinhoodEarn";
import { mainnetPortfolio } from "../../support/mainnetWallet";
import { mockOpportunityService, opportunityDetail } from "../../support/opportunities";

const Stack = createNativeStackNavigator<RootStackParamList>();
const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
beforeEach(() => {
  delete process.env.EXPO_PUBLIC_SWAP_DEMO;
});
afterEach(() => {
  if (originalFlag !== undefined) process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
  jest.restoreAllMocks();
});

function setup(cycle?: EarnIntent) {
  const service = {
    load: jest.fn().mockResolvedValue(cycle ?? { status: "absent" }),
    list: jest.fn().mockResolvedValue(cycle ? [cycle] : []),
    prepare: jest.fn(),
    select: jest.fn().mockResolvedValue(cycle),
    cancel: jest.fn(),
  };
  const catalog = mockOpportunityService();
  catalog.detail.mockResolvedValue({
    ...opportunityDetail(1),
    id: "steakhouse",
    name: "Steakhouse USDG",
    chainId: 4663,
    vaultAddress: earnProfiles["robinhood-usdg"].vault,
    asset: {
      address: earnProfiles["robinhood-usdg"].token,
      symbol: "USDG",
      name: "USDG",
      decimals: 6,
    },
  });
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
      <EarnProvider service={service}>
        <OpportunityServiceContext.Provider value={catalog}>
          <NavigationContainer>
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              <Stack.Screen
                name="VaultWithdraw"
                component={VaultWithdrawScreen}
                initialParams={{ opportunityId: "steakhouse" }}
              />
              <Stack.Screen name="EarnInvestment" component={EarnInvestmentScreen} />
            </Stack.Navigator>
          </NavigationContainer>
        </OpportunityServiceContext.Provider>
      </EarnProvider>
    </MainnetWalletProvider>,
  );
  return service;
}

test.each([
  undefined,
  { ...hoodIntent, walletId: "other-wallet" },
  { ...hoodIntent, sourceAddress: "0x" + "9".repeat(40) },
])(
  "withdrawal entry never creates new wallets or exposes another wallet's cycle",
  async (cycle) => {
    const service = setup(cycle);
    expect(
      await screen.findByText("No saved investments to withdraw from this vault."),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review withdrawal" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Prepare/ })).toBeNull();
    expect(service.prepare).not.toHaveBeenCalled();
    expect(service.select).not.toHaveBeenCalled();
  },
);

test("withdrawal opens the owned saved investment without a new preparation phase", async () => {
  const service = setup(hoodIntent);
  fireEvent.press(await screen.findByRole("button", { name: "Review withdrawal" }));
  expect(await screen.findByText("Saved investment")).toBeVisible();
  expect(screen.getByText("Steakhouse USDG")).toBeVisible();
  expect(service.prepare).not.toHaveBeenCalled();
  expect(screen.queryByRole("button", { name: /Prepare/ })).toBeNull();
});
