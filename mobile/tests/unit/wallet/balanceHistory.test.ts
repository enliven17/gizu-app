import {
  appendBalancePoint,
  balanceChange,
  balanceSeries,
  parseBalanceHistory,
} from "@/domain/wallet/balanceHistory";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("records new readings and collapses noisy refreshes", () => {
  let history = appendBalancePoint([], { at: 0, atoms: "1000000" });
  history = appendBalancePoint(history, { at: HOUR, atoms: "1000000" });
  expect(history).toHaveLength(1);
  history = appendBalancePoint(history, { at: 2 * HOUR, atoms: "2000000" });
  history = appendBalancePoint(history, { at: 2.5 * HOUR, atoms: "2500000" });
  expect(history).toEqual([
    { at: 0, atoms: "1000000" },
    { at: 2.5 * HOUR, atoms: "2500000" },
  ]);
  expect(appendBalancePoint(history, { at: HOUR, atoms: "9" })).toBe(history);
  expect(appendBalancePoint(history, { at: 9 * HOUR, atoms: "-1" })).toBe(history);
});

test("selects the period and reports change", () => {
  const history = [
    { at: 0, atoms: "100000000" },
    { at: 25 * DAY, atoms: "110000000" },
    { at: 29 * DAY, atoms: "121000000" },
  ];
  expect(balanceSeries(history, "1W", 30 * DAY)).toEqual([110, 121]);
  expect(balanceSeries(history, "All", 30 * DAY)).toEqual([100, 110, 121]);
  expect(balanceSeries(history, "1Y", 390 * DAY)).toEqual([110, 121]);
  expect(balanceChange([100, 110, 121])).toEqual({ delta: 21, percent: 21 });
  expect(balanceChange([0, 5])).toEqual({ delta: 5, percent: null });
  expect(balanceChange([5])).toBeNull();
});

test("ignores malformed stored history", () => {
  expect(parseBalanceHistory("x")).toEqual([]);
  expect(parseBalanceHistory([{ at: 1, atoms: "5" }, { at: "1", atoms: "5" }, null])).toEqual([
    { at: 1, atoms: "5" },
  ]);
});
