import { createDemoVaultService } from "@/services/demo/vaults";

const owner = { walletId: "demo-wallet", address: "0x" + "1".repeat(40) };
const vault = "demo-morpho-steakhouse-usdg";
const originalFlag = process.env.EXPO_PUBLIC_SWAP_DEMO;
beforeEach(() => {
  process.env.EXPO_PUBLIC_SWAP_DEMO = "1";
});
afterEach(() => {
  if (originalFlag === undefined) delete process.env.EXPO_PUBLIC_SWAP_DEMO;
  else process.env.EXPO_PUBLIC_SWAP_DEMO = originalFlag;
});

test("mock withdrawals debit only the selected position and return a stable receipt", () => {
  const service = createDemoVaultService();
  const quote = service.review(owner, vault, "100000000");
  expect(quote.receiveAtoms).toBe("99900000");
  expect(service.balance(owner, vault)).toBe("250000000");
  const receipt = service.confirm(owner, quote.id);
  expect(service.confirm(owner, quote.id)).toEqual(receipt);
  expect(service.balance(owner, vault)).toBe("150000000");
  expect(service.balance(owner, "demo-aave-usdc")).toBe("250000000");
  receipt.receiveAtoms = "999999999";
  expect(service.confirm(owner, quote.id).receiveAtoms).toBe("99900000");
});

test("rejects invalid amounts, unregistered vaults and requests outside demo mode", () => {
  const service = createDemoVaultService();
  for (const amount of ["0", "-1", "1", "1.5", "250000001"])
    expect(() => service.review(owner, vault, amount)).toThrow();
  expect(() => service.review(owner, "demo-morpho-unknown", "100000000")).toThrow(/not part/);
  expect(() => service.review({ walletId: "" }, vault, "100000000")).toThrow(/Sign in/);
  process.env.EXPO_PUBLIC_SWAP_DEMO = "0";
  expect(() => service.review(owner, vault, "100000000")).toThrow(/turned off/);
});

test("expired or stale estimates cannot debit a vault again", () => {
  let time = 1000;
  const service = createDemoVaultService(() => time);
  const expired = service.review(owner, vault, "100000000");
  time = expired.expiresAt;
  expect(() => service.confirm(owner, expired.id)).toThrow(/expired/);
  expect(service.balance(owner, vault)).toBe("250000000");
  const first = service.review(owner, vault, "100000000");
  const stale = service.review(owner, vault, "100000000");
  service.confirm(owner, first.id);
  expect(() => service.confirm(owner, stale.id)).toThrow(/balance changed/);
  expect(service.balance(owner, vault)).toBe("150000000");
});

test("positions and confirmation belong to the exact wallet and source address", () => {
  const service = createDemoVaultService();
  const quote = service.review(owner, vault, "250000000");
  for (const foreign of [
    { ...owner, walletId: "another-wallet" },
    { ...owner, address: "0x" + "2".repeat(40) },
  ]) {
    expect(() => service.confirm(foreign, quote.id)).toThrow(/another wallet/);
    expect(service.balance(foreign, vault)).toBe("250000000");
  }
  service.confirm(owner, quote.id);
  expect(service.balance(owner, vault)).toBe("0");
  expect(() => service.review(owner, vault, "1000000")).toThrow(/exceeds/);
});

test("Home position valuations match withdrawals and omit fully withdrawn positions", () => {
  const service = createDemoVaultService();
  const seeds = service.portfolioPositions(owner);
  expect(seeds).toHaveLength(4);
  expect(seeds.every((row) => row.valueUsdcAtoms === service.balance(owner, row.assetId))).toBe(
    true,
  );
  const quote = service.review(owner, vault, "100000000");
  service.confirm(owner, quote.id);
  expect(
    service.portfolioPositions(owner).find((row) => row.assetId === vault)?.valueUsdcAtoms,
  ).toBe("150000000");
  const rest = service.review(owner, vault, "150000000");
  service.confirm(owner, rest.id);
  expect(service.portfolioPositions(owner).map((row) => row.assetId)).not.toContain(vault);
  expect(service.portfolioPositions({ ...owner, walletId: "other" })).toHaveLength(4);
});

test("demo deposits add the net value once and share withdrawal position revisions", () => {
  const service = createDemoVaultService();
  const quote = service.reviewDeposit(owner, vault, "100000000", "250000000");
  expect(service.balance(owner, vault)).toBe("250000000");
  expect(quote.receiveAtoms).toBe("99900000");
  const result = service.confirmDeposit(owner, quote.id, "250000000");
  expect(service.balance(owner, vault)).toBe("349900000");
  expect(service.confirmDeposit(owner, quote.id, "0")).toEqual(result);
  expect(service.balance(owner, vault)).toBe("349900000");
  expect(() => service.confirm(owner, quote.id)).toThrow();
  const withdrawal = service.review(owner, vault, "100000000");
  expect(() => service.confirmDeposit(owner, withdrawal.id, "250000000")).toThrow();
});

test("changed cash, stale vault state, wrong ownership and expired deposits never increase positions", () => {
  let time = 1000;
  const service = createDemoVaultService(() => time);
  const quote = service.reviewDeposit(owner, vault, "100000000", "250000000");
  expect(() =>
    service.confirmDeposit({ ...owner, walletId: "foreign" }, quote.id, "250000000"),
  ).toThrow();
  expect(() => service.confirmDeposit(owner, quote.id, "50000000")).toThrow(/USDC changed/);
  expect(service.balance(owner, vault)).toBe("250000000");
  time = quote.expiresAt;
  expect(() => service.confirmDeposit(owner, quote.id, "250000000")).toThrow(/expired/);
  const stale = service.reviewDeposit(owner, vault, "100000000", "250000000");
  service.confirm(owner, service.review(owner, vault, "100000000").id);
  expect(() => service.confirmDeposit(owner, stale.id, "250000000")).toThrow(
    /vault balance changed/,
  );
  expect(service.balance(owner, vault)).toBe("150000000");
});
