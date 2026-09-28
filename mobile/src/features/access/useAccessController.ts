import { WalletUnavailableError } from "@/services/wallet/nativeBridge";
import { useEffect, useRef, useState } from "react";
import { useSession } from "@/application/SessionProvider";
import { AccessRejectedError } from "@/services/access";
type AccessViewModel = {
  pending: boolean;
  error: string | null;
  start: () => Promise<void>;
  restore: () => Promise<void>;
  canRestore: boolean;
  cancel: () => void;
};

export function useAccessController(): AccessViewModel {
  const { accessService, signIn } = useSession();
  const attempt = useRef(0);
  const inFlight = useRef(false);
  const [canRestore, setCanRestore] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    if (!pending)
      accessService
        .canRestore?.()
        .then((value) => {
          if (current) setCanRestore(value);
        })
        .catch(() => {
          if (current) setCanRestore(false);
        });
    return () => {
      current = false;
    };
  }, [accessService, pending]);
  useEffect(
    () => () => {
      attempt.current += 1;
      accessService.cancel?.();
    },
    [accessService],
  );
  function cancel() {
    accessService.cancel?.();
    attempt.current += 1;
    inFlight.current = false;
    setPending(false);
    setError(null);
  }
  async function start(restoring = false) {
    if (inFlight.current) return;
    inFlight.current = true;
    const id = ++attempt.current;
    setPending(true);
    setError(null);
    try {
      const session =
        restoring && accessService.restore
          ? await accessService.restore()
          : await accessService.request(accessService.method ?? "Demo passkey");
      if (id === attempt.current) signIn(session);
    } catch (cause) {
      if (id === attempt.current)
        setError(
          cause instanceof WalletUnavailableError
            ? cause.message
            : cause instanceof AccessRejectedError
              ? "Access was rejected. You can try again."
              : accessService.method === "Passkey"
                ? "Wallet access or backup was not completed. Continue to retry the same wallet. If local storage cannot be read, restore your backup with the original passkey."
                : "Access failed. Please try again.",
        );
    } finally {
      if (id === attempt.current) {
        inFlight.current = false;
        setPending(false);
      }
    }
  }
  return { pending, error, start, cancel, canRestore, restore: () => start(true) };
}
