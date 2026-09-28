import { storedHistory } from "@/services/wallet/storedTransfers";
const walletId = "7aafcc2e-0891-4e31-a7d4-03780d7b4f12",
  address = "0x" + "1".repeat(40);
const op = {
  operationId: walletId,
  walletId,
  revision: 2,
  status: "needsAuthorization",
  canResume: true,
  blocked: true,
  raw: "secret",
  steps: [
    {
      index: 0,
      accountIndex: 0,
      from: address,
      to: "0x" + "2".repeat(40),
      valueWei: "1",
      status: "signed",
      nonce: "0",
      transactionHash: "0x" + "a".repeat(64),
      raw: "secret",
      quote: {},
    },
  ],
};
test("projection keeps signed state and resume revision but no private native payload", () => {
  const history = storedHistory([op], walletId, address);
  expect(history.operations?.[0]?.revision).toBe(2);
  expect(history.blocked).toBe(true);
  expect(history.entries[0]!.status).toBe("signed");
  expect(JSON.stringify(history)).not.toContain("secret");
  expect(JSON.stringify(history)).not.toContain("quote");
});
test.each([
  { ...op, walletId: "different" },
  { ...op, revision: 1.5 },
  { ...op, steps: [{ ...op.steps[0], nonce: undefined }] },
  { ...op, steps: [{ ...op.steps[0], transactionHash: "0x123" }] },
  { ...op, steps: [{ ...op.steps[0], valueWei: "100000000000000001" }] },
])("rejects malformed or wrong-wallet native history", (value) => {
  expect(() => storedHistory([value], walletId, address)).toThrow();
});
test("duplicate operation identifiers are rejected", () =>
  expect(() => storedHistory([op, op], walletId, address)).toThrow());

test.each([
  null,
  { ...op, steps: [null] },
  { ...op, status: "invented" },
  { ...op, steps: [{ ...op.steps[0], accountIndex: 16 }] },
  { ...op, steps: [{ ...op.steps[0], status: "invented" }] },
  { ...op, steps: [] },
  { ...op, steps: Array.from({ length: 33 }, (_, index) => ({ ...op.steps[0], index })) },
])("rejects invalid response shapes and policy limits", (value) => {
  expect(() => storedHistory([value], walletId, address)).toThrow();
});

test("history keeps newest-first order, filters other senders, and drops planned private fields", () => {
  const planned = {
    ...op,
    operationId: "7aafcc2e-0891-4e31-a7d4-03780d7b4f13",
    steps: [{ ...op.steps[0], status: "planned" }],
  };
  const otherSender = {
    ...op,
    operationId: "7aafcc2e-0891-4e31-a7d4-03780d7b4f14",
    steps: [{ ...op.steps[0], from: "0x" + "3".repeat(40) }],
  };
  const history = storedHistory([op, planned, otherSender], walletId, address);
  expect(history.operations?.map((item) => item.operationId)).toEqual([
    otherSender.operationId,
    planned.operationId,
    op.operationId,
  ]);
  expect(history.entries).toHaveLength(1);
  expect(history.operations?.[1]?.steps[0]).not.toHaveProperty("transactionHash");
  expect(JSON.stringify(history)).not.toContain("secret");
});
