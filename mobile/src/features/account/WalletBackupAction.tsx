import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/atoms/Button";
import { Notice } from "@/components/molecules/Notice";
import { getStoredSigner } from "@/services/wallet/nativeBridge";

export function WalletBackupAction() {
  const attempt = useRef(0);
  const running = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  useEffect(
    () => () => {
      attempt.current++;
      if (running.current) getStoredSigner()?.lock();
    },
    [],
  );
  async function backup() {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setResult(null);
    const id = ++attempt.current;
    try {
      const state = await getStoredSigner()?.backupWallet();
      if (state?.status !== "ready") throw new Error("Backup incomplete");
      if (attempt.current === id)
        setResult(
          "Backup saved and verified. Recovery requires this file and your original passkey.",
        );
    } catch {
      if (attempt.current === id)
        setResult(
          "Backup was not completed. Your existing wallet remains available. Try again when ready.",
        );
    } finally {
      if (attempt.current === id) {
        running.current = false;
        setBusy(false);
      }
    }
  }
  return (
    <>
      <Button
        label="Save and verify wallet backup"
        variant="secondary"
        disabled={busy}
        loading={busy}
        onPress={() => void backup()}
      />
      {result && <Notice message={result} />}
    </>
  );
}
