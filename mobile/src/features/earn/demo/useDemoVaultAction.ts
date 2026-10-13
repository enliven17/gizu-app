import { useEffect, useMemo, useRef, useState } from "react";
import { parseSwapAmount } from "@/domain/swap";
import { formatUsdc } from "@/domain/wallet/amounts";
import { useFundingWallet } from "@/features/wallet/WalletProvider";
import { swapDemo } from "@/features/swap/demo/swapDemo";
import { demoVaults, demoVaultFeeAtoms, type DemoVaultQuote } from "@/services/demo/vaults";

export function useDemoVaultAction(vaultId: string, kind: "deposit" | "withdrawal") {
  const wallet = useFundingWallet();
  const { session } = wallet;
  const deposit = kind === "deposit";
  const owner = useMemo(
    () => ({ walletId: session.walletId ?? "", address: session.address }),
    [session.walletId, session.address],
  );
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<DemoVaultQuote | null>(null);
  const [phase, setPhase] = useState<"amount" | "review" | "processing" | "done">("amount");
  const [message, setMessage] = useState("");
  const occupied = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const balanceAtoms = deposit
    ? swapDemo.usdcAtoms().toString()
    : demoVaults.balance(owner, vaultId);
  const atoms = parseSwapAmount(amount.replace(",", "."));
  const fee = atoms === null ? 0n : demoVaultFeeAtoms(atoms);
  const balanceLoading = deposit && wallet.loading;
  const balanceUnavailable = deposit && (wallet.error || wallet.balance === null);
  const valid =
    !balanceLoading &&
    !balanceUnavailable &&
    atoms !== null &&
    atoms > fee &&
    atoms <= BigInt(balanceAtoms);
  return {
    amount,
    phase,
    quote,
    balance: formatUsdc(balanceAtoms),
    address: session.address,
    balanceLoading,
    balanceUnavailable,
    message:
      message ||
      (phase !== "amount"
        ? ""
        : atoms !== null && atoms > BigInt(balanceAtoms)
          ? deposit
            ? "Enter an amount within your available USDC."
            : "This amount exceeds your vault balance."
          : amount && !valid
            ? deposit
              ? "Enter a valid USDC amount that covers the estimated fee."
              : "Enter a valid amount within your vault balance."
            : ""),
    canReview: phase === "amount" && valid,
    empty: balanceAtoms === "0",
    setAmount: (text: string) => {
      if (phase !== "amount") return;
      setAmount(text);
      setMessage("");
    },
    max: () => {
      if (phase === "amount") {
        setAmount(formatUsdc(balanceAtoms));
        setMessage("");
      }
    },
    review: () => {
      if (!valid || atoms === null || phase !== "amount") return;
      try {
        setQuote(
          deposit
            ? demoVaults.reviewDeposit(
                owner,
                vaultId,
                atoms.toString(),
                swapDemo.usdcAtoms().toString(),
              )
            : demoVaults.review(owner, vaultId, atoms.toString()),
        );
        setPhase("review");
        setMessage("");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Couldn’t prepare the review.");
      }
    },
    edit: () => {
      if (phase !== "review") return;
      setPhase("amount");
      setQuote(null);
      setMessage("");
    },
    confirm: () => {
      if (!quote || phase !== "review" || occupied.current) return;
      occupied.current = true;
      try {
        const receipt = deposit
          ? demoVaults.confirmDeposit(owner, quote.id, swapDemo.usdcAtoms().toString())
          : demoVaults.confirm(owner, quote.id);
        if (deposit) swapDemo.debitVaultDeposit(receipt.id, BigInt(receipt.amountAtoms));
        else swapDemo.creditVaultWithdrawal(receipt.id, BigInt(receipt.receiveAtoms));
        setQuote(receipt);
        setPhase("processing");
        timer.current = setTimeout(() => setPhase("done"), 700);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : `Couldn’t finish your ${kind}.`);
        occupied.current = false;
      }
    },
  };
}
