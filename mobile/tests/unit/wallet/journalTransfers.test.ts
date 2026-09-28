import { createWalletTransfers } from "@/development/legacySigner/transfers";
import { walletHistory } from "@/development/legacySigner/journal";
const address = "0x" + "1".repeat(40);
const recipient = "0x" + "2".repeat(40);
const hash = "0x" + "a".repeat(64);
const row = {
  from: address,
  chainId: 10143,
  nonce: "0",
  status: "finalized",
  transactionHash: hash,
};
test("history is scoped to the selected wallet and legacy details are not invented", () => {
  const result = walletHistory(
    JSON.stringify([
      row,
      {
        ...row,
        from: recipient,
        transactionHash: "0x" + "b".repeat(64),
        status: "unknown",
      },
    ]),
    address,
  );
  expect(result).toEqual({
    entries: [{ transactionHash: hash, status: "finalized", nonce: "0" }],
    blocked: true,
  });
});
test("new records retain exact amount and recipient, and untrusted extras are discarded", () => {
  const result = walletHistory(
    JSON.stringify([{ ...row, to: recipient, valueWei: "1", extra: "discard" }]),
    address,
  );
  expect(result.entries[0]).toEqual({
    transactionHash: hash,
    status: "finalized",
    nonce: "0",
    to: recipient,
    valueWei: "1",
  });
});
test.each([
  { chainId: 1 },
  { from: "invalid" },
  { nonce: "-1" },
  { to: recipient },
  { valueWei: "NaN", to: recipient },
])("rejects invalid journal metadata", (override) => {
  expect(() => walletHistory(JSON.stringify([{ ...row, ...override }]), address)).toThrow();
});
test("rejects duplicate records and submits only sender-bound exact proposals", async () => {
  expect(() => walletHistory(JSON.stringify([row, row]), address)).toThrow("Duplicate");
  const bridge = {
    executeOperation: jest.fn().mockResolvedValue(JSON.stringify([row])),
    getOperationStatus: jest.fn().mockResolvedValue("[]"),
    cancelOperation: jest.fn(),
  };
  const service = createWalletTransfers(() => bridge);
  await service.send(address, recipient, "0.001");
  expect(JSON.parse(bridge.executeOperation.mock.calls[0][0])).toEqual({
    kind: "nativeTransfers",
    chainId: 10143,
    transfers: [
      { accountIndex: 0, to: recipient, valueWei: "1000000000000000", expectedFrom: address },
    ],
  });
  await expect(service.history(address)).resolves.toEqual({ entries: [], blocked: false });
  service.cancel();
  expect(bridge.cancelOperation).toHaveBeenCalledTimes(1);
  await expect(createWalletTransfers(() => null).history(address)).rejects.toThrow("unavailable");
});
