import { MainnetVaults } from "@/features/opportunities/MainnetVaults";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import type { OpportunityDetail } from "@/domain/opportunities";
import { OpportunityDetailScreen } from "@/features/opportunities/OpportunityDetailScreen";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import { EarnScreen } from "@/features/earn/EarnScreen";
import type { RootStackParamList } from "@/navigation/types";
import { deferred } from "../../support/renderApp";
import {
  mockOpportunityService,
  opportunityDetail,
  type MockOpportunityService,
} from "../../support/opportunities";

const Stack = createNativeStackNavigator<RootStackParamList>();

afterEach(() => jest.restoreAllMocks());

function setup(service: MockOpportunityService = mockOpportunityService()) {
  render(
    <SafeAreaProvider>
      <OpportunityServiceContext.Provider value={service}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen
              name="OpportunityDetail"
              component={OpportunityDetailScreen}
              initialParams={{ id: "op-1" }}
            />
            <Stack.Screen name="Earn" component={EarnScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </OpportunityServiceContext.Provider>
    </SafeAreaProvider>,
  );
  return service;
}

test("detail shows the summary card, TVL history and opens Deposit inside Gizu", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const service = mockOpportunityService();
  const pending = deferred<OpportunityDetail>();
  service.detail.mockReturnValueOnce(pending.promise);
  setup(service);
  expect(screen.getByLabelText("Loading vault…")).toBeVisible();
  await act(async () => pending.resolve(opportunityDetail(1)));

  expect(screen.getByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.getByText("Aave · Monad · LIVE")).toBeVisible();
  expect(screen.getByLabelText("Total APR 6.1%")).toBeVisible();
  expect(screen.getByLabelText("TVL $1M")).toBeVisible();
  expect(
    await screen.findByLabelText("TVL history: Start $900K · End $1M (3 samples)"),
  ).toBeVisible();
  expect(screen.getByLabelText("Daily rewards: $1.5K")).toBeVisible();
  for (const heading of ["About", "How to", "Tokens", "Details", "Campaigns"]) {
    expect(screen.queryByRole("header", { name: heading })).toBeNull();
  }
  expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
  expect(service.detail).toHaveBeenCalledWith("op-1", expect.anything());
  expect(service.tvlRecords).toHaveBeenCalledWith("op-1", expect.anything());

  expect(screen.queryByRole("link", { name: "Open deposit page" })).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Deposit" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Deposits to this vault are not available in Gizu yet. No funds have moved.",
  );
  expect(openURL).not.toHaveBeenCalled();
});

test("earnings estimate projects the typed amount at the vault rate", async () => {
  setup();
  expect(await screen.findByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.getByLabelText("After 1 year: about $1,061.00, earning $61.00")).toBeVisible();
  const amount = screen.getByLabelText("Deposit amount in USD");
  await userEvent.clear(amount);
  await userEvent.type(amount, "2000");
  await userEvent.press(screen.getByRole("radio", { name: "6M" }));
  expect(screen.getByLabelText("After 6 months: about $2,061.00, earning $61.00")).toBeVisible();
  await userEvent.clear(amount);
  await userEvent.type(amount, "abc");
  expect(screen.getByRole("alert")).toHaveTextContent(/Enter an amount/);
  expect(screen.getByLabelText("Estimate unavailable")).toBeVisible();
});

test("Deposit stays inside Gizu regardless of provider URLs", async () => {
  const service = mockOpportunityService();
  service.detail.mockResolvedValue({ ...opportunityDetail(1), depositUrl: "javascript:alert(1)" });
  setup(service);
  expect(await screen.findByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Open deposit page" })).toBeNull();
  expect(screen.getByRole("button", { name: "Deposit" })).toBeEnabled();
});

test("detail failure can be retried and a failed history still shows a flat chart", async () => {
  const service = mockOpportunityService();
  service.detail.mockRejectedValueOnce(new Error("offline"));
  service.tvlRecords.mockRejectedValue(new Error("offline"));
  setup(service);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn’t load this vault.");
  expect(screen.queryByLabelText("Mainnet vault 1")).toBeNull();
  await userEvent.press(screen.getByRole("button", { name: "Retry vault" }));
  expect(await screen.findByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(await screen.findByLabelText("TVL history unavailable")).toBeVisible();
  expect(service.detail).toHaveBeenCalledTimes(2);
});

test("a vault without history draws a flat line", async () => {
  const service = mockOpportunityService();
  service.tvlRecords.mockResolvedValue([]);
  setup(service);
  expect(await screen.findByLabelText("No TVL history yet")).toBeVisible();
  expect(screen.queryByText(/no data/i)).toBeNull();
});

test("configured vault detail shows the contract and unavailable metrics without invented prices or history", async () => {
  const service = mockOpportunityService();
  const address = "0x1111111111111111111111111111111111111111";
  const base = opportunityDetail(1);
  service.detail.mockResolvedValue({
    ...base,
    name: "Configured vault",
    symbol: "gzpAUSD",
    protocol: { id: "morpho", name: "Morpho" },
    vaultAddress: address,
    rateType: "apy",
    totalApr: null,
    apr: null,
    tvl: null,
    nativeApr: null,
    dailyRewards: null,
    liveCampaigns: 0,
    campaigns: [],
    tokens: base.tokens.map((token) => ({ ...token, price: null })),
  });
  service.tvlRecords.mockResolvedValue([]);
  setup(service);
  expect(await screen.findByLabelText("Configured vault")).toBeVisible();
  expect(screen.getByLabelText("Morpho logo", { includeHiddenElements: true })).toBeTruthy();
  expect(screen.getByLabelText("Net APY Unavailable")).toBeVisible();
  expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(2);
  expect(screen.getByLabelText("Estimate unavailable")).toBeVisible();
  expect(screen.queryByLabelText("No TVL history yet")).toBeNull();
  expect(screen.queryByText("$0")).toBeNull();
});

test("returning from vault details retains appended catalog pages without reloading", async () => {
  const service = mockOpportunityService();
  const first = opportunityDetail(1);
  const second = opportunityDetail(2);
  service.list.mockResolvedValueOnce({ list: [first], total: 9, page: 0, items: 8 });
  service.list.mockResolvedValueOnce({ list: [second], total: 9, page: 1, items: 8 });
  service.detail.mockResolvedValue(second);
  render(
    <SafeAreaProvider>
      <OpportunityServiceContext.Provider value={service}>
        <NavigationContainer>
          <Stack.Navigator screenOptions={{ headerShown: false }}>
            <Stack.Screen name="Main">
              {({ navigation }) => (
                <MainnetVaults onOpen={(id) => navigation.navigate("OpportunityDetail", { id })} />
              )}
            </Stack.Screen>
            <Stack.Screen name="OpportunityDetail" component={OpportunityDetailScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </OpportunityServiceContext.Provider>
    </SafeAreaProvider>,
  );
  await screen.findByText(first.name);
  await userEvent.press(screen.getByRole("button", { name: "Load more" }));
  await userEvent.press(await screen.findByRole("button", { name: `View ${second.name}` }));
  await screen.findByLabelText(second.name);
  await userEvent.press(screen.getByRole("button", { name: "Back" }));
  expect(await screen.findByText("All vaults loaded.")).toBeVisible();
  expect(screen.getByText(first.name)).toBeVisible();
  expect(screen.getByText(second.name)).toBeVisible();
  expect(service.list).toHaveBeenCalledTimes(2);
});
