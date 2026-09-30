import { loadSwapTokens, parseSwapView, sourceAtoms } from "@/features/swap/confidentialSwap";

test("source amount stays inside the 10 USDC cap", () => {
  expect(sourceAtoms("2")).toBe("2000000");
  expect(sourceAtoms("10")).toBe("10000000");
  expect(sourceAtoms("10.000001")).toBeNull();
  expect(sourceAtoms("0")).toBeNull();
});

test("token list keeps only swap-listed assets", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      list: [
        {
          address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
          symbol: "AMZN",
          name: "Amazon",
          decimals: 18,
          swapListed: true,
        },
        {
          address: "0x0000000000000000000000000000000000000001",
          symbol: "NO",
          name: "Hidden",
          decimals: 18,
          swapListed: false,
        },
      ],
    }),
  });
  await expect(loadSwapTokens(fetchImpl as unknown as typeof fetch)).resolves.toEqual([
    {
      address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54",
      symbol: "AMZN",
      name: "Amazon",
      decimals: 18,
      swapListed: true,
    },
  ]);
});

test("public swap status drops anything that is not a status field", () => {
  expect(
    parseSwapView({
      operationId: "op",
      phase: "FUNDING",
      step: "FundingSubmit",
      fundingAddress: "0xabc",
      signed: "secret",
    }).phase,
  ).toBe("FUNDING");
  expect(
    parseSwapView({
      operationId: "op",
      phase: "COMPLETE",
      fundingAddress: "0xabc",
      direction: "sell",
      returnAddresses: ["0x1", 2, "0x2"],
    }).returnAddresses,
  ).toEqual(["0x1", "0x2"]);
});
