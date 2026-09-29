import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MainnetVaults } from "@/features/opportunities/MainnetVaults";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import type { OpportunityPage, OpportunityService } from "@/domain/opportunities";
import { deferred } from "../../support/renderApp";
import { tvlRecords } from "../../support/opportunities";
// The sparkline is decorative (hidden from assistive tech); query it explicitly.
const hidden = { includeHiddenElements: true };
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
function setup(fail = false) {
  const list = jest
    .fn<ReturnType<OpportunityService["list"]>, Parameters<OpportunityService["list"]>>()
    .mockResolvedValue(page);
  if (fail) list.mockRejectedValueOnce(new Error("offline"));
  const tvl = jest
    .fn<
      ReturnType<OpportunityService["tvlRecords"]>,
      Parameters<OpportunityService["tvlRecords"]>
    >()
    .mockResolvedValue(tvlRecords);
  const detail = jest.fn<
    ReturnType<OpportunityService["detail"]>,
    Parameters<OpportunityService["detail"]>
  >();
  const onOpen = jest.fn<void, [string]>();
  const service: OpportunityService = { list, detail, tvlRecords: tvl };
  const view = render(
    <SafeAreaProvider>
      <OpportunityServiceContext.Provider value={service}>
        <MainnetVaults onOpen={onOpen} />
      </OpportunityServiceContext.Provider>
    </SafeAreaProvider>,
  );
  return { list, tvl, onOpen, ...view };
}
test("mainnet listing shows real metrics without investment actions and supports pagination and filters", async () => {
  const { list } = setup();
  expect(screen.getByText("Loading vaults…")).toBeVisible();
  expect(await screen.findByText("Lend USDC on Aave")).toBeVisible();
  expect(screen.getByText("6.1% total APR")).toBeVisible();
  expect(screen.queryByRole("button", { name: /deposit|withdraw|buy/i })).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
  list.mockResolvedValueOnce({
    ...page,
    page: 1,
    list: [{ ...page.list[0]!, id: "2", name: "Second vault" }],
  });
  await userEvent.press(screen.getByRole("button", { name: "Load more" }));
  expect(await screen.findByText("Second vault")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  expect(screen.getByText("Lend USDC on Aave")).toBeVisible();
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
  const { list } = setup(true);
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
test("cards draw a TVL sparkline and open their vault", async () => {
  const { tvl, onOpen } = setup();
  const card = await screen.findByRole("button", { name: "View Lend USDC on Aave" });
  expect(await within(card).findByText("+5.26%")).toBeVisible();
  expect(within(card).getByTestId("sparkline", hidden)).toBeTruthy();
  expect(tvl).toHaveBeenCalledWith("1", expect.anything());
  await userEvent.press(card);
  expect(onOpen).toHaveBeenCalledWith("1");
});
test("empty history draws a flat line instead of a no-data message", async () => {
  const { tvl } = setup();
  tvl.mockResolvedValue([]);
  const card = await screen.findByRole("button", { name: "View Lend USDC on Aave" });
  await waitFor(() => expect(within(card).getByTestId("sparkline", hidden)).toBeTruthy());
  expect(within(card).getByText("LIVE")).toBeVisible();
  expect(screen.queryByText(/no data/i)).toBeNull();
});
test("a failed history omits the sparkline without blocking the list", async () => {
  const { tvl } = setup();
  tvl.mockRejectedValue(new Error("offline"));
  const card = await screen.findByRole("button", { name: "View Lend USDC on Aave" });
  await waitFor(() => expect(tvl).toHaveBeenCalled());
  await act(async () => {});
  expect(within(card).queryByTestId("sparkline", hidden)).toBeNull();
  expect(within(card).getByText("6.1% total APR")).toBeVisible();
  expect(screen.getByRole("button", { name: "Load more" })).toBeEnabled();
});

test("refresh replaces vault results and reuses successful sparkline history", async () => {
  const { list, tvl } = setup();
  await screen.findByText("Lend USDC on Aave");
  await waitFor(() => expect(tvl).toHaveBeenCalledTimes(1));
  list.mockResolvedValueOnce({
    ...page,
    page: 1,
    list: [{ ...page.list[0]!, id: "2", name: "Second vault" }],
  });
  fireEvent(screen.getByLabelText("vaults list"), "endReached");
  await screen.findByText("Second vault");
  list.mockResolvedValueOnce({ ...page, total: 1 });
  fireEvent(screen.getByLabelText("vaults list"), "refresh");
  await screen.findByText("All vaults loaded.");
  expect(screen.queryByText("Second vault")).toBeNull();
  expect(list.mock.lastCall?.[0].page).toBe(0);
  expect(tvl.mock.calls.filter(([id]) => id === "1")).toHaveLength(1);
});
