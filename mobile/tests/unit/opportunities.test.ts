import { safeExternalUrl, tvlChange, tvlSeries } from "@/domain/opportunities";

test("TVL records are plotted oldest first and change compares the last two samples", () => {
  const series = tvlSeries([{ total: 110 }, { total: 100 }, { total: 90 }]);
  expect(series).toEqual([90, 100, 110]);
  expect(tvlChange(series)).toBeCloseTo(10);
  expect(tvlChange([100, 50])).toBe(-50);
  expect(tvlChange([0, 5])).toBeNull();
  expect(tvlChange([5])).toBeNull();
});

test("only https deposit pages are offered", () => {
  expect(safeExternalUrl("https://app.aave.com/x")).toBe("https://app.aave.com/x");
  for (const url of ["", "http://app.aave.com", "javascript:alert(1)", "https://a b"]) {
    expect(safeExternalUrl(url)).toBeNull();
  }
});

test("money formats compact USD without relying on Intl compact notation (Hermes)", () => {
  const { money } = jest.requireActual<typeof import("@/features/opportunities/format")>(
    "@/features/opportunities/format",
  );
  expect(money.format(52_118_331.2)).toBe("$52.1M");
  expect(money.format(999_950)).toBe("$1M");
  expect(money.format(1_250)).toBe("$1.3K");
  expect(money.format(42)).toBe("$42");
  expect(money.format(3_400_000_000)).toBe("$3.4B");
});
