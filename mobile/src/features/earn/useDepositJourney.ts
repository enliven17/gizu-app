import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import {
  canConfirmDeposit,
  type DepositPauseCode,
  type DepositSnapshot,
} from "@/domain/earn/depositJourney";
import type { EarnProfileId } from "@/domain/earn/types";
import { useFundingWallet } from "@/features/wallet/WalletProvider";
import { useEarn } from "./EarnProvider";
export const depositPauseCopy: Record<DepositPauseCode, string> = {
  quoteUnavailable: "The route is unavailable. Review again when the provider recovers.",
  previewUnavailable: "A fresh fee estimate is unavailable. No new spending can be approved.",
  insufficientFunds: "Your available USDC does not cover this budget and gas.",
  uneconomicAmount: "This amount is too small to cover routing, gas and the withdrawal reserve.",
  termsChanged:
    "The live terms changed. Saved transactions remain tracked; review the remaining limits before continuing.",
  approvalExpired: "Approval ended. Review the remaining steps to continue.",
  settlementPending: "Waiting for verified confidential credit. Funds will not be paid out early.",
  submissionUnknown:
    "A submitted transaction needs verification. Check saved progress before retrying.",
  recoveryRequired: "Saved activity needs recovery before another deposit can be approved.",
  unsupportedCapability: "This build does not support this deposit. Update the native app.",
  cancelled: "Approval stopped. Submitted transactions remain tracked.",
};
export function depositBudgetAtoms(text: string): string | null {
  if (!/^(0|[1-9][0-9]{0,30})(\.[0-9]{1,6})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const atoms = BigInt(whole!) * 1000000n + BigInt(fraction.padEnd(6, "0"));
  return atoms > 10000n ? atoms.toString() : null;
}
const running = ["authorizing", "funding", "settlingCredit", "payouts", "depositing"];
export function useDepositJourney(profileId: EarnProfileId, savedJourneyId?: string) {
  const wallet = useFundingWallet(),
    { depositJourney: service } = useEarn();
  const owner = useMemo(
    () => ({ walletId: wallet.session.walletId ?? "", address: wallet.session.address }),
    [wallet.session.walletId, wallet.session.address],
  );
  const [amount, setAmountText] = useState(""),
    [snapshot, setSnapshot] = useState<DepositSnapshot | null>(null),
    [available, setAvailable] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [details, setDetails] = useState(false),
    [clock, setClock] = useState(Date.now());
  const saved = useRef<DepositSnapshot | null>(null),
    request = useRef(0),
    mounted = useRef(false),
    occupied = useRef(false),
    foreground = useRef(true),
    started = useRef(Date.now()),
    epoch = useRef(0),
    authorizing = useRef(false);
  const accept = useCallback(
    (next: DepositSnapshot) => {
      if (next.profileId !== profileId)
        throw new Error("The saved deposit belongs to a different vault.");
      saved.current = next;
      setSnapshot((old) =>
        old && old.journeyId === next.journeyId && old.revision > next.revision ? old : next,
      );
    },
    [profileId],
  );
  const revoke = useCallback(() => {
    const row = saved.current;
    if (row && row.phase !== "invested")
      void service
        .cancel(owner, row.journeyId, row.revision)
        .then((next) => {
          if (mounted.current) accept(next);
        })
        .catch(() => {
          if (mounted.current)
            setMessage("Approval stopped. Check saved progress before continuing.");
        });
  }, [service, owner, accept]);
  useEffect(() => {
    ++epoch.current;
    saved.current = null;
    setSnapshot(null);
    setAmountText("");
    setLoading(true);
    mounted.current = true;
    foreground.current = AppState.currentState !== "background";
    started.current = Date.now();
    const attempt = ++request.current;
    void service
      .available()
      .then(async (enabled) => {
        if (!mounted.current || attempt !== request.current) return;
        setAvailable(enabled);
        if (enabled && savedJourneyId) {
          const next = await service.status(owner, savedJourneyId);
          if (mounted.current && attempt === request.current) accept(next);
        }
      })
      .catch((error) => {
        if (mounted.current && attempt === request.current)
          setMessage(error instanceof Error ? error.message : "Deposit unavailable.");
      })
      .finally(() => {
        if (mounted.current && attempt === request.current) setLoading(false);
      });
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        foreground.current = false;
        if (!authorizing.current) {
          ++request.current;
          revoke();
        }
      } else if (state === "active") {
        foreground.current = true;
        setClock(Date.now());
      }
    });
    return () => {
      mounted.current = false;
      ++epoch.current;
      ++request.current;
      subscription.remove();
      revoke();
    };
  }, [service, owner, savedJourneyId, accept, revoke]);
  useEffect(() => {
    if (!snapshot || snapshot.phase === "invested" || !foreground.current) return;
    if (snapshot.phase === "review" && (snapshot.review?.expiresAtMs ?? 0) > Date.now()) {
      const timer = setTimeout(
        () => setClock(Date.now()),
        Math.max(1, (snapshot.review?.expiresAtMs ?? Date.now()) - Date.now()),
      );
      return () => clearTimeout(timer);
    }
    if (
      !running.includes(snapshot.phase) &&
      !(
        snapshot.phase === "paused" &&
        ["settlementPending", "submissionUnknown"].includes(snapshot.pauseReason ?? "")
      )
    )
      return;
    let disposed = false,
      timer: ReturnType<typeof setTimeout> | undefined,
      count = 0;
    async function poll() {
      if (disposed || !foreground.current || Date.now() - started.current >= 900000) return;
      try {
        const next = await service.status(owner, snapshot!.journeyId);
        if (!disposed && mounted.current) accept(next);
      } catch {
        if (!disposed && mounted.current)
          setMessage("Could not check saved progress. Submitted funds remain tracked.");
      }
      if (!disposed)
        timer = setTimeout(
          () => void poll(),
          [2000, 4000, 8000, 16000, 30000][Math.min(count++, 4)]!,
        );
    }
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [snapshot?.journeyId, snapshot?.phase, snapshot?.pauseReason, service, owner, accept, clock]);
  const perform = async (task: () => Promise<DepositSnapshot>) => {
    if (occupied.current || !foreground.current) return;
    occupied.current = true;
    setBusy(true);
    setMessage("");
    const attempt = ++request.current,
      sessionEpoch = epoch.current;
    try {
      const next = await task();
      if (epoch.current !== sessionEpoch) {
        void service.cancel(owner, next.journeyId, next.revision).catch(() => undefined);
        return;
      }
      saved.current = next;
      if (mounted.current && foreground.current && attempt === request.current) accept(next);
      else if (!mounted.current || !foreground.current)
        void service.cancel(owner, next.journeyId, next.revision).catch(() => undefined);
    } catch (error) {
      if (mounted.current && attempt === request.current) {
        setMessage(
          error instanceof Error ? error.message : "Deposit stopped. Check saved activity.",
        );
        try {
          const next = await service.status(owner, saved.current?.journeyId ?? "current-deposit");
          if (mounted.current && attempt === request.current) accept(next);
        } catch {
          /* no invented rollback */
        }
      }
    } finally {
      occupied.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const atoms = depositBudgetAtoms(amount),
    editable =
      !snapshot ||
      ["draft", "review", "preparing"].includes(snapshot.phase) ||
      (snapshot.phase === "paused" &&
        !snapshot.completedSteps.length &&
        snapshot.creditedAtoms === "0" &&
        [
          "previewUnavailable",
          "quoteUnavailable",
          "insufficientFunds",
          "uneconomicAmount",
        ].includes(snapshot.pauseReason ?? ""));
  return {
    amount,
    snapshot,
    available,
    loading,
    busy,
    message,
    details,
    setDetails,
    editable,
    setAmount: (text: string) => {
      if (!editable) return;
      ++request.current;
      setAmountText(text);
      setSnapshot(null);
      setMessage("");
    },
    canReview:
      available &&
      !loading &&
      !busy &&
      !!atoms &&
      editable &&
      !wallet.loading &&
      !wallet.error &&
      wallet.balance !== null &&
      !!depositBudgetAtoms(wallet.balance) &&
      BigInt(atoms ?? "0") <= BigInt(depositBudgetAtoms(wallet.balance) ?? "0"),
    canConfirm: !busy && !!snapshot && canConfirmDeposit(snapshot, Math.max(clock, Date.now())),
    review: () =>
      atoms
        ? perform(() => service.prepare(owner, profileId, atoms, saved.current?.journeyId))
        : Promise.resolve(),
    confirm: async () => {
      if (!snapshot || !canConfirmDeposit(snapshot, Date.now()) || occupied.current) return;
      authorizing.current = true;
      try {
        await perform(() => service.confirm(owner, snapshot.journeyId, snapshot.revision));
      } finally {
        authorizing.current = false;
      }
    },
    resume: async () => {
      if (!snapshot || occupied.current) return;
      authorizing.current = true;
      try {
        await perform(() => service.resume(owner, snapshot.journeyId, snapshot.revision));
      } finally {
        authorizing.current = false;
      }
    },
    cancel: () => {
      ++request.current;
      revoke();
    },
    refresh: () =>
      snapshot ? perform(() => service.status(owner, snapshot.journeyId)) : Promise.resolve(),
    balance: wallet.balance,
    balanceLoading: wallet.loading,
    balanceUnavailable: wallet.error,
  };
}
