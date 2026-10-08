import { groupDigits } from "@/domain/wallet/amounts";
import { holdingAmount } from "@/features/swap/SwapHoldingsSection";

test("groups whole digits without touching the fraction", () => {
  expect(groupDigits("12485.25")).toBe("12,485.25");
  expect(groupDigits("1234567")).toBe("1,234,567");
  expect(groupDigits("999.123456")).toBe("999.123456");
  expect(groupDigits("0.5")).toBe("0.5");
  expect(holdingAmount("12485250000", 6)).toBe("12,485.25");
  expect(holdingAmount("1000000000", 0)).toBe("1,000,000,000");
  expect(holdingAmount("19990574", 6)).toBe("19.990574");
});
