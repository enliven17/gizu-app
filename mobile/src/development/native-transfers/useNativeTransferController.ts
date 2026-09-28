import { useEffect, useRef, useState } from "react";

import {
  parseNativeStatus,
  transferProposal,
  type TransferStatus,
} from "@/domain/wallet/transfers";
import { type NativeTransfers } from "@/development/legacySigner/nativeBridge";
export function useNativeTransferController(service: NativeTransfers | null) {
  const [account, setAccount] = useState("0");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("0.001");
  const [count, setCount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "Testnet MON only. Native review is required before signing.",
  );
  const [results, setResults] = useState<TransferStatus[]>([]);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      service?.cancelOperation();
    };
  }, [service]);
  async function run(refresh: boolean) {
    if (!service || running.current) return;
    let proposal = "";
    if (!refresh) {
      try {
        proposal = transferProposal(account, recipient.trim(), amount.trim(), count);
      } catch {
        setMessage(
          "Enter account 0–15, a full recipient address, and an amount above 0 up to 0.1 MON, and 1–16 transfers totaling at most 1 MON.",
        );
        return;
      }
    }
    running.current = true;
    setBusy(true);
    try {
      const result = await (refresh
        ? service.getOperationStatus()
        : service.executeOperation(proposal));
      const statuses = parseNativeStatus(result);
      if (mounted.current) {
        setResults(statuses);
        setMessage(
          statuses.length
            ? "Native transaction status below. Pending or unknown transfers must be reconciled before retrying."
            : "No native transfers recorded.",
        );
      }
    } catch {
      if (mounted.current)
        setMessage(
          "Operation stopped or unavailable. Refresh native status before retrying. Check testnet funds and connectivity; submitted transfers cannot be undone.",
        );
    } finally {
      running.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return {
    account,
    setAccount,
    recipient,
    setRecipient,
    amount,
    setAmount,
    count,
    setCount,
    busy,
    message,
    results,
    review: () => run(false),
    refresh: () => run(true),
  };
}
