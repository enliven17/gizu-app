import { SignStatus, useSignOverlay, type SignState } from "@/components/molecules/SignStatus";
import type { useWalletTransfers } from "@/features/wallet/useWalletTransfers";

type NativePhase = ReturnType<typeof useWalletTransfers>["phase"];

// Only a stopped native action is unambiguous; other outcomes are read from history.
function signState(phase: NativePhase): SignState | null {
  if (phase === "awaitingNative" || phase === "cancelling") return "signing";
  if (phase === "recoveryRequired") return "failed";
  return null;
}

/**
 * Orb behind the native review/passkey screens. Native owns approval and has no JS
 * cancel, so the overlay carries no actions.
 */
export function NativeSignOverlay({ phase }: { phase: NativePhase }) {
  const state = useSignOverlay(signState(phase));
  if (!state) return null;
  return (
    <SignStatus
      layout="overlay"
      state={state}
      tone={state === "failed" ? "negative" : "positive"}
      label={
        state === "failed"
          ? "Not completed"
          : phase === "cancelling"
            ? "Cancelling with passkey"
            : "Waiting for passkey"
      }
    />
  );
}
