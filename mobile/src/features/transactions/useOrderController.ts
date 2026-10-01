import { useEffect, useRef, useState } from "react";
import {
  calculateQuote,
  decimal,
  maximum,
  TransactionError,
  type OperationKind,
  type Quote,
} from "@/domain/transactions";
import { unresolved, useTransactions } from "./TransactionProvider";

export function useOrderController(kind: OperationKind, vaultId?: string) {
  const { account, service, operation, error: accountError, loading } = useTransactions();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quoting, setQuoting] = useState(false);
  const attempt = useRef(0),
    lock = useRef(false);
  useEffect(
    () => () => {
      attempt.current++;
    },
    [],
  );
  function edit(value = amount) {
    attempt.current++;
    lock.current = false;
    setQuoting(false);
    setQuote(null);
    setError(null);
    setAmount(value);
  }
  function percentage(percent: number) {
    if (!account) return;
    try {
      edit(decimal((maximum(account, { kind, vaultId }) * BigInt(percent)) / 100n));
    } catch (cause) {
      setError(
        cause instanceof TransactionError
          ? cause.message
          : "Unable to validate the amount. Try again.",
      );
    }
  }
  const blocked = loading || !!accountError || !account || !service || unresolved(operation);
  async function review() {
    if (lock.current || blocked || !account || !service) return;
    const input = { kind, vaultId, amount };
    try {
      calculateQuote(account, input);
    } catch (cause) {
      setError(
        cause instanceof TransactionError
          ? cause.message
          : "Unable to validate the amount. Try again.",
      );
      return;
    }
    lock.current = true;
    setQuoting(true);
    setError(null);
    const token = ++attempt.current;
    try {
      const result = await service.quote(input);
      if (token === attempt.current) setQuote(result);
    } catch (cause) {
      if (token === attempt.current)
        setError(
          cause instanceof TransactionError ? cause.message : "Unable to get a quote. Try again.",
        );
    } finally {
      if (token === attempt.current) {
        lock.current = false;
        setQuoting(false);
      }
    }
  }
  return { amount, quote, error, quoting, blocked, edit, percentage, review };
}
