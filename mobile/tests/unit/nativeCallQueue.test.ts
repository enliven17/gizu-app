import { NativeCallQueue } from "@/services/wallet/nativeCallQueue";
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
};
test("coalesces reads and prioritizes explicit actions", async () => {
  const queue = new NativeCallQueue();
  const first = deferred<number>();
  const read = jest.fn(() => first.promise);
  const a = queue.run(read, "balance");
  const b = queue.run(read, "balance");
  expect(a).toBe(b);
  const order: string[] = [];
  const status = queue.run(async () => {
    order.push("status");
  }, "status");
  const sign = queue.run(async () => {
    order.push("sign");
  });
  await tick();
  expect(read).toHaveBeenCalledTimes(1);
  expect(order).toEqual([]);
  first.resolve(4);
  await Promise.all([a, b, status, sign]);
  expect(order).toEqual(["sign", "status"]);
});
test("post-action refresh does not reuse a pre-action observation", async () => {
  const queue = new NativeCallQueue();
  const first = deferred<number>();
  const a = queue.run(() => first.promise, "balance");
  const action = queue.run(async () => undefined);
  const b = queue.run(async () => 5, "balance");
  expect(a).not.toBe(b);
  first.resolve(4);
  expect(await b).toBe(5);
  await action;
});
test("failure releases the lane without retrying transactions", async () => {
  const queue = new NativeCallQueue();
  const send = jest.fn(async () => {
    throw new Error("rejected");
  });
  const error = expect(queue.run(send)).rejects.toThrow("rejected");
  const read = queue.run(async () => 7, "balance");
  await error;
  expect(await read).toBe(7);
  expect(send).toHaveBeenCalledTimes(1);
});
test("lock rejects queued actions and late results", async () => {
  const queue = new NativeCallQueue();
  const first = deferred<number>();
  const active = queue.run(() => first.promise, "balance");
  const sign = jest.fn(async () => 1);
  const waiting = queue.run(sign);
  const activeError = expect(active).rejects.toThrow("cancelled");
  const waitingError = expect(waiting).rejects.toThrow("cancelled");
  await tick();
  queue.lock(jest.fn());
  first.resolve(5);
  await Promise.all([activeError, waitingError]);
  expect(sign).not.toHaveBeenCalled();
  expect(await queue.run(async () => 6, "balance")).toBe(6);
});
test("cancel interrupts immediately and holds dispatch until both operations settle", async () => {
  const queue = new NativeCallQueue();
  const first = deferred<number>();
  const stopped = deferred<void>();
  const active = queue.run(() => first.promise);
  const rejected = expect(active).rejects.toThrow("cancelled");
  await tick();
  const cancel = jest.fn(() => stopped.promise);
  const cancellation = queue.interrupt(cancel);
  expect(cancel).toHaveBeenCalledTimes(1);
  const next = jest.fn(async () => 6);
  const waiting = queue.run(next, "status");
  first.resolve(1);
  await rejected;
  await tick();
  expect(next).not.toHaveBeenCalled();
  stopped.resolve();
  await cancellation;
  expect(await waiting).toBe(6);
});
test("background drops waiting actions while native code owns the active prompt", async () => {
  const queue = new NativeCallQueue();
  const first = deferred<number>();
  const active = queue.run(() => first.promise);
  const next = jest.fn(async () => 5);
  const waiting = queue.run(next);
  const rejected = expect(waiting).rejects.toThrow("cancelled");
  queue.cancelPending();
  first.resolve(1);
  await rejected;
  expect(await active).toBe(1);
  expect(next).not.toHaveBeenCalled();
});
