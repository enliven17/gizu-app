import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MainnetVaults } from "@/features/opportunities/MainnetVaults";

const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
beforeEach(() => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  else process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
  jest.restoreAllMocks();
});

test("demo vaults filter, search and open using complete local data", async () => {
  const network = jest
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new Error("Unexpected network"));
  const onOpen = jest.fn();
  render(
    <SafeAreaProvider>
      <MainnetVaults onOpen={onOpen} />
    </SafeAreaProvider>,
  );
  await screen.findByRole("button", { name: "View Aave V3 USDC" });
  expect(screen.queryByText(/Some vaults are unavailable/)).toBeNull();
  for (const [protocol, firstVault] of [
    ["Aave", "Aave V3 USDC"],
    ["Morpho", "Pendle Ecosystem USDC"],
    ["Curvance", "High Yield AUSD"],
  ]) {
    fireEvent.press(screen.getByRole("radio", { name: protocol }));
    await screen.findByRole("button", { name: `View ${firstVault}` });
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(6));
    expect(screen.getByText("All vaults loaded.")).toBeVisible();
  }
  fireEvent.changeText(screen.getByLabelText("Search opportunities"), "WBTC");
  const card = await screen.findByRole("button", { name: "View WBTC / USDC" });
  expect(screen.getAllByRole("button", { name: /^View / })).toHaveLength(1);
  fireEvent.press(card);
  expect(onOpen).toHaveBeenCalledWith("demo-curvance-wbtc-usdc");
  fireEvent.changeText(screen.getByLabelText("Search opportunities"), "missing");
  expect(await screen.findByText("No vaults match your filters.")).toBeVisible();
  expect(network).not.toHaveBeenCalled();
});
