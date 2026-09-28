import { act, fireEvent, render, screen, userEvent, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MainnetVaults } from "@/features/opportunities/MainnetVaults";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import type { OpportunityPage, OpportunityService } from "@/domain/opportunities";
import { deferred } from "../../support/renderApp";
const page: OpportunityPage = {
  page: 0,
  items: 8,
  total: 9,
  list: [
    {
      id: "1",
      name: "Lend USDC on Aave",
      chainId: 143,
      protocol: { id: "aave", name: "Aave" },
      status: "LIVE",
      totalApr: 6.1,
      tvl: 1000000,
    },
  ],
};
function setup() {
  const list = jest
    .fn<ReturnType<OpportunityService["list"]>, Parameters<OpportunityService["list"]>>()
    .mockResolvedValue(page);
  const view = render(
    <SafeAreaProvider>
      <OpportunityServiceContext.Provider value={{ list }}>
        <MainnetVaults />
      </OpportunityServiceContext.Provider>
    </SafeAreaProvider>,
  );
  return { list, ...view };
}
test("mainnet listing shows real metrics without investment actions and supports pagination and filters", async () => {
  const { list } = setup();
  expect(screen.getByText("Loading vaults…")).toBeVisible();
  expect(await screen.findByText("Lend USDC on Aave")).toBeVisible();
  expect(screen.getByText("Monad mainnet · Browse only")).toBeVisible();
  expect(screen.getByText("6.1% total APR")).toBeVisible();
  expect(screen.queryByRole("button", { name: /deposit|withdraw|buy/i })).toBeNull();
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  list.mockResolvedValueOnce({
    ...page,
    page: 1,
    list: [{ ...page.list[0]!, id: "2", name: "Second vault" }],
  });
  await userEvent.press(screen.getByRole("button", { name: "Next page" }));
  expect(await screen.findByText("Second vault")).toBeVisible();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  await userEvent.press(screen.getByRole("radio", { name: "Morpho" }));
  await screen.findByText("Lend USDC on Aave");
  expect(list).toHaveBeenLastCalledWith(
    { search: "", protocol: "morpho", page: 0 },
    expect.anything(),
  );
  list.mockResolvedValueOnce({ ...page, list: [], total: 0 });
  fireEvent.changeText(screen.getByLabelText("Search opportunities"), "missing");
  expect(await screen.findByText("No vaults match your filters.")).toBeVisible();
  expect(list).toHaveBeenLastCalledWith(
    { search: "missing", protocol: "morpho", page: 0 },
    expect.anything(),
  );
  await userEvent.press(screen.getByRole("button", { name: "Clear filters" }));
  await screen.findByText("Lend USDC on Aave");
  expect(list).toHaveBeenLastCalledWith(
    { search: "", protocol: "all", page: 0 },
    expect.anything(),
  );
});
test("failure can be retried and old responses cannot replace new results", async () => {
  const { list } = setup();
  list.mockRejectedValueOnce(new Error("offline"));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Vault catalog unavailable. Please retry.",
  );
  await userEvent.press(screen.getByRole("button", { name: "Retry vaults" }));
  await screen.findByText("Lend USDC on Aave");
  const old = deferred<OpportunityPage>();
  list.mockReturnValueOnce(old.promise);
  fireEvent.changeText(screen.getByLabelText("Search opportunities"), "old");
  await waitFor(() =>
    expect(list).toHaveBeenLastCalledWith(
      { search: "old", protocol: "all", page: 0 },
      expect.anything(),
    ),
  );
  const signal = list.mock.calls.at(-1)![1];
  list.mockResolvedValueOnce({ ...page, list: [], total: 0 });
  fireEvent.changeText(screen.getByLabelText("Search opportunities"), "new");
  expect(await screen.findByText("No vaults match your filters.")).toBeVisible();
  expect(signal.aborted).toBe(true);
  await act(async () => old.resolve(page));
  expect(screen.queryByText("Lend USDC on Aave")).toBeNull();
});
