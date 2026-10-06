type Pending = {
  start: () => void;
  reject: (error: Error) => void;
  read: boolean;
};
const cancelled = () => new Error("Wallet operation cancelled. Please try again when ready.");

/** One native storage/ceremony lane, shared by all feature adapters. Never retries work. */
export class NativeCallQueue {
  private pending: Pending[] = [];
  private active = false;
  private interrupts = 0;
  private generation = 0;
  private reads = new Map<string, Promise<unknown>>();

  run<T>(work: () => Promise<T>, readKey?: string): Promise<T> {
    if (readKey === undefined) this.reads.clear();
    const existing = readKey ? this.reads.get(readKey) : undefined;
    if (existing) return existing as Promise<T>;
    const generation = this.generation;
    const result = new Promise<T>((resolve, reject) => {
      this.pending.push({
        read: readKey !== undefined,
        reject,
        start: () => {
          this.active = true;
          void Promise.resolve()
            .then(() => {
              if (generation !== this.generation) throw cancelled();
              return work();
            })
            .then(
              (value) => (generation === this.generation ? resolve(value) : reject(cancelled())),
              reject,
            )
            .finally(() => {
              this.active = false;
              this.drain();
            });
        },
      });
    });
    if (readKey) {
      this.reads.set(readKey, result);
      const clear = () => {
        if (this.reads.get(readKey) === result) this.reads.delete(readKey);
      };
      void result.then(clear, clear);
    }
    this.drain();
    return result;
  }

  /** Backgrounding drops waiting requests, but native code owns active prompt cancellation. */
  cancelPending() {
    const waiting = this.pending.splice(0);
    this.reads.clear();
    for (const item of waiting) item.reject(cancelled());
  }

  lock(work: () => void) {
    this.generation++;
    this.cancelPending();
    work();
  }

  /** Native cancellation must be able to interrupt the operation occupying the lane. */
  async interrupt<T>(work: () => Promise<T>): Promise<T> {
    this.generation++;
    this.cancelPending();
    this.interrupts++;
    try {
      return await work();
    } finally {
      this.interrupts--;
      this.drain();
    }
  }

  private drain() {
    if (this.active || this.interrupts) return;
    // Explicit user actions take precedence over waiting balance/status refreshes.
    const action = this.pending.findIndex((item) => !item.read);
    const item = this.pending.splice(action < 0 ? 0 : action, 1)[0];
    item?.start();
  }
}
