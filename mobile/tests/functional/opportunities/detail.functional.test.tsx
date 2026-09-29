import { MainnetVaults } from "@/features/opportunities/MainnetVaults";
import { act, render, screen, userEvent } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { Linking } from "react-native";
import type { OpportunityDetail } from "@/domain/opportunities";
import { OpportunityDetailScreen } from "@/features/opportunities/OpportunityDetailScreen";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
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
          </Stack.Navigator>
        </NavigationContainer>
      </OpportunityServiceContext.Provider>
    </SafeAreaProvider>,
  );
  return service;
}

test("detail shows the frontend sections, TVL history and only an external deposit link", async () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  const service = mockOpportunityService();
  const pending = deferred<OpportunityDetail>();
  service.detail.mockReturnValueOnce(pending.promise);
  setup(service);
  expect(screen.getByText("Loading vault…")).toBeVisible();
  await act(async () => pending.resolve(opportunityDetail(1)));

  expect(screen.getByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.getByText("Aave · Monad · LIVE")).toBeVisible();
  expect(screen.getByLabelText("Total APR 6.1%")).toBeVisible();
  expect(
    await screen.findByLabelText("TVL history: Start $900K · End $1M (3 samples)"),
  ).toBeVisible();
  for (const value of ["$1M", "4.25%", "1.85%", "$1.5K", "2", "LEND"]) {
    expect(screen.getAllByText(value).length).toBeGreaterThan(0);
  }
  for (const heading of ["About", "How to", "Tokens", "Details", "Campaigns"]) {
    expect(screen.getByRole("header", { name: heading })).toBeVisible();
  }
  expect(screen.getByText("Supply USDC to earn lending yield.")).toBeVisible();
  expect(screen.getByLabelText("Step 2: Hold the receipt token")).toBeVisible();
  expect(screen.getByLabelText("Tags: stable, lending")).toBeVisible();
  expect(screen.getByText("Lending incentive")).toBeVisible();
  expect(service.detail).toHaveBeenCalledWith("op-1", expect.anything());
  expect(service.tvlRecords).toHaveBeenCalledWith("op-1", expect.anything());

  expect(screen.queryByRole("button", { name: /buy|sell|withdraw|deposit/i })).toBeNull();
  await userEvent.press(screen.getByRole("link", { name: "Open deposit page" }));
  expect(openURL).toHaveBeenCalledWith("https://app.aave.com/reserve");
});

test("non-https deposit URLs are not offered", async () => {
  const service = mockOpportunityService();
  service.detail.mockResolvedValue({ ...opportunityDetail(1), depositUrl: "javascript:alert(1)" });
  setup(service);
  expect(await screen.findByLabelText("Mainnet vault 1")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Open deposit page" })).toBeNull();
});

test("detail failure can be retried and a failed history still shows a flat chart", async () => {
  const service = mockOpportunityService();
  service.detail.mockRejectedValueOnce(new Error("offline"));
  service.tvlRecords.mockRejectedValue(new Error("offline"));
  setup(service);
  expect(await screen.findByRole("alert")).toHaveTextContent("Vault unavailable. Please retry.");
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
