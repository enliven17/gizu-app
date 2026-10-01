import { useCallback, useEffect, useRef, useState } from "react";
import type { ClipboardService } from "@/services/clipboard";
import { formatMon } from "@/domain/wallet/amounts";
import { type WalletBalanceService } from "@/services/wallet/balance";

export function useWalletController(
  address: string,
  service: WalletBalanceService,
  clipboard: ClipboardService,
  formatBalance: (atoms: string) => string = formatMon,
) {
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [copied, setCopied] = useState<"idle" | "pending" | "done" | "failed">("idle");
  const active = useRef(true);
  const request = useRef<AbortController | null>(null);
  const copying = useRef(false);
  const load = useCallback(() => {
    if (request.current) return Promise.resolve();
    const controller = new AbortController();
    request.current = controller;
    return Promise.resolve()
      .then(() => service.getBalance(address, controller.signal))
      .then((atoms) => {
        const value = formatBalance(atoms);
        if (active.current && !controller.signal.aborted) setBalance(value);
      })
      .catch(() => {
        if (active.current && !controller.signal.aborted) {
          setBalance(null);
          setError(true);
        }
      })
      .finally(() => {
        if (request.current === controller) request.current = null;
        if (active.current && !controller.signal.aborted) setLoading(false);
      });
  }, [address, service, formatBalance]);
  useEffect(() => {
    active.current = true;
    void load();
    return () => {
      active.current = false;
      request.current?.abort();
      request.current = null;
    };
  }, [load]);
  const refresh = useCallback(async () => {
    if (request.current) return;
    setLoading(true);
    setError(false);
    await load();
  }, [load]);
  async function copy() {
    if (copying.current) return;
    copying.current = true;
    setCopied("pending");
    try {
      await clipboard.copy(address);
      if (active.current) setCopied("done");
    } catch {
      if (active.current) setCopied("failed");
    } finally {
      copying.current = false;
    }
  }
  return { balance, loading, error, refresh, copied, copy };
}
