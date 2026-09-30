import { formatSwapAmount, parseSwapAmount } from "@/domain/swap";

test("private balance atoms render as trimmed USDC", () => {
  expect(formatSwapAmount(1993140n)).toBe("1.99314");
  expect(formatSwapAmount(996570n)).toBe("0.99657");
  expect(formatSwapAmount(2000000n)).toBe("2");
  expect(formatSwapAmount(1n)).toBe("0.000001");
});

test("formatting round-trips through parsing", () => {
  for (const text of ["0.5", "1.99314", "10"]) {
    expect(formatSwapAmount(parseSwapAmount(text)!)).toBe(text);
  }
});
