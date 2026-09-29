import { createMockTransactionService } from "@/services/transactions";
import { decimal, maximum, parseAmount, type OperationKind } from "@/domain/transactions";

test.each(["buy", "sell", "deposit", "withdraw"] as OperationKind[])(
  "%s changes balances only once after confirmation",
  async (kind) => {
    const service = createMockTransactionService();
    const before = await service.load();
    const q = await service.quote({
      kind,
      vaultId: kind === "buy" || kind === "sell" ? "vertex" : undefined,
      amount: kind === "buy" ? "10000" : "100",
    });
    const authorization = await service.sign(q.id);
    const pending = await service.submit(q.id, authorization, "key");
    expect(pending.status).toBe("pending");
    expect(await service.load()).toEqual(before);
    expect(await service.submit(q.id, authorization, "key")).toEqual(pending);
    await expect(service.submit(q.id, authorization, "other-key")).rejects.toThrow(
      "already been submitted",
    );
    await expect(service.quote({ kind: "deposit", amount: "10" })).rejects.toThrow("pending");
    expect((await service.status("key")).status).toBe("confirmed");
    const after = await service.load();
    expect(after.revision).toBe(1);
    await service.status("key");
    expect(await service.load()).toEqual(after);
    if (kind === "deposit") {
      expect(BigInt(after.cash) - BigInt(before.cash)).toBe(BigInt(q.credit));
      expect(BigInt(before.wallet) - BigInt(after.wallet)).toBe(BigInt(q.debit));
    }
    if (kind === "withdraw") {
      expect(BigInt(before.cash) - BigInt(after.cash)).toBe(BigInt(q.debit));
      expect(BigInt(after.wallet) - BigInt(before.wallet)).toBe(BigInt(q.credit));
    }
    if (kind === "buy")
      expect(BigInt(after.vaults[2]!.units) - BigInt(before.vaults[2]!.units)).toBe(
        BigInt(q.credit),
      );
    if (kind === "sell")
      expect(BigInt(before.vaults[2]!.redeemable) - BigInt(after.vaults[2]!.redeemable)).toBe(
        parseAmount("100"),
      );
  },
);
test("quote expiry is checked again after signing", async () => {
  let now = 1000;
  const service = createMockTransactionService(undefined, { now: () => now });
  const q = await service.quote({ kind: "deposit", amount: "100" });
  const auth = await service.sign(q.id);
  now += 60000;
  await expect(service.submit(q.id, auth, "expired")).rejects.toThrow("expired");
  expect((await service.load()).revision).toBe(0);
});
test("unknown submissions reconcile; delayed confirmations stay pending; failed settlements do not debit", async () => {
  for (const scenario of ["unknown", "delayed", "settlement-failure"] as const) {
    const service = createMockTransactionService(undefined, { scenario });
    const q = await service.quote({ kind: "deposit", amount: "10" });
    const auth = await service.sign(q.id);
    if (scenario === "unknown")
      await expect(service.submit(q.id, auth, "key")).rejects.toThrow("unknown");
    else await service.submit(q.id, auth, "key");
    const first = await service.status("key");
    expect(first.status).toBe(
      scenario === "delayed"
        ? "pending"
        : scenario === "settlement-failure"
          ? "failed"
          : "confirmed",
    );
    await service.status("key");
    expect((await service.load()).revision).toBe(scenario === "settlement-failure" ? 0 : 1);
  }
});
test("new locked purchases stay locked; a new holding appears and unlocked Max can fully sell", async () => {
  const service = createMockTransactionService();
  const buy = await service.quote({ kind: "buy", vaultId: "meridian", amount: "5000" });
  await service.submit(buy.id, await service.sign(buy.id), "buy");
  await service.status("buy");
  const account = await service.load();
  expect(account.holdings.some((h) => h.id === "meridian")).toBe(true);
  expect(account.vaults.find((v) => v.id === "meridian")!.redeemable).toBe("0");
  const sell = await service.quote({
    kind: "sell",
    vaultId: "vertex",
    amount: decimal(maximum(account, { kind: "sell", vaultId: "vertex" })),
  });
  await service.submit(sell.id, await service.sign(sell.id), "sell");
  await service.status("sell");
  expect((await service.load()).holdings.some((h) => h.id === "vertex")).toBe(false);
});
