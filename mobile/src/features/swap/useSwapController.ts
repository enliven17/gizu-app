import { useEffect, useRef, useState } from "react";
import {
  mockSwapBalance,
  parseSwapAmount,
  type SwapOrder,
  type SwapQuote,
  type SwapService,
} from "@/domain/swap";
import { createMockSwapService } from "@/services/mockSwap";

export function useSwapController(provided?: SwapService) {
  const [service] = useState(() => provided ?? createMockSwapService());
  const [symbol, setSymbol] = useState("AMZN");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote>();
  const [order, setOrder] = useState<SwapOrder>();
  const [history, setHistory] = useState<SwapOrder[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const spent = history.reduce((sum, item) => sum + parseSwapAmount(item.quote.input)!, 0n);
  const balance = mockSwapBalance - spent;
  const value = parseSwapAmount(amount);
  const validation =
    value === null || value < 1000000n
      ? "Enter at least 1 USDG, with up to 6 decimal places."
      : value > balance
        ? "Not enough simulated USDG."
        : "";
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "Simulation unavailable. Try again.");
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    symbol,
    setSymbol,
    amount,
    setAmount,
    quote,
    order,
    history,
    busy,
    error,
    validation,
    balance,
    review: () =>
      run(async () => {
        if (validation) {
          setError(validation);
          return;
        }
        const current = ++generation.current;
        const result = await service.quote(symbol, amount);
        if (mounted.current && current === generation.current) setQuote(result);
      }),
    edit: () => {
      setQuote(undefined);
      setError("");
    },
    confirm: () =>
      run(async () => {
        if (!quote || order) return;
        if (Date.now() >= quote.expiresAt)
          throw new Error("Quote expired. Go back and request a new quote.");
        const result = await service.submit(quote);
        if (!mounted.current) return;
        setOrder(result);
        setHistory((items) => [...items.filter((item) => item.id !== result.id), result]);
      }),
    refresh: () =>
      run(async () => {
        if (!order) return;
        const result = await service.status(order.id);
        if (!mounted.current) return;
        setOrder(result);
        setHistory((items) => items.map((item) => (item.id === result.id ? result : item)));
      }),
    reset: () => {
      setQuote(undefined);
      setOrder(undefined);
      setAmount("");
      setError("");
    },
  };
}
