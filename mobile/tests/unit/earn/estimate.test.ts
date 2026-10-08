import { estimateEarnings, parseEstimateAmount } from "@/domain/earn/estimate";

test("parses typed USD amounts and rejects invalid input", () => {
  expect(parseEstimateAmount("1,250.50")).toBe(1250.5);
  expect(parseEstimateAmount(" 100 ")).toBe(100);
  for (const bad of ["", "0", "-5", "1.234", "abc", "1e3", "2000000000"])
    expect(parseEstimateAmount(bad)).toBeNull();
});

test("APR projects simple interest and APY compounds", () => {
  expect(estimateEarnings(1000, 10, "apr", "6M").earned).toBeCloseTo(50);
  expect(estimateEarnings(1000, 10, "apr", "1Y")).toEqual({ earned: 100, total: 1100 });
  expect(estimateEarnings(1000, 10, "apy", "1Y").earned).toBeCloseTo(100);
  expect(estimateEarnings(1000, 10, "apy", "6M").earned).toBeCloseTo(48.81, 2);
  expect(estimateEarnings(1200, 12, "apr", "1M").earned).toBeCloseTo(12);
});
