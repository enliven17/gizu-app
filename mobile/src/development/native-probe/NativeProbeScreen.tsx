import { useEffect, useRef, useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";

import { NativeTransferScreen } from "@/development/native-transfers/NativeTransferScreen";
import type { NativeTransfers } from "@/development/legacySigner/nativeBridge";

type PublicProof = { accountIndex: number; address: string; message: string; signature: string };
export type NativeProbe = {
  openNativeProbe(): Promise<PublicProof[]>;
  cancelProbe(): void;
};
// Only public-result methods. No PRF, salt, path, payload or secret input API.
export function NativeProbeScreen({
  service,
  onTransfers,
}: {
  service: NativeProbe | null;
  onTransfers?: () => void;
}) {
  const [proofs, setProofs] = useState<PublicProof[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "This probe signs fixed test messages only. Transfers require separate native review.",
  );
  const running = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      service?.cancelProbe();
    };
  }, [service]);
  async function run() {
    if (!service || running.current) return;
    running.current = true;
    setBusy(true);
    setProofs([]);
    try {
      const result = await service.openNativeProbe();
      if (active.current) {
        setProofs(result);
        setMessage(
          `Native probe returned ${result.length} verified test signatures. Device acceptance must be recorded separately.`,
        );
      }
    } catch {
      if (active.current)
        setMessage(
          "Native probe cancelled or failed. Open an existing passkey after partial creation; no automatic retry.",
        );
    } finally {
      running.current = false;
      if (active.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <Typography variant="title">Native signer N1</Typography>
      <Typography>
        Use an unfunded test passkey. The native prompt controls creation and access. No wallet
        secrets are returned to this screen.
      </Typography>
      <Typography>
        {service
          ? message
          : "Native module unavailable. Build and install the new development client."}
      </Typography>
      <Button
        label="Open native test prompt"
        disabled={!service}
        loading={busy}
        onPress={() => void run()}
      />
      {onTransfers && <Button label="Test native transfers" onPress={onTransfers} />}
      {proofs.map((proof) => (
        <Typography key={proof.accountIndex}>
          Account {proof.accountIndex}: {proof.address}
        </Typography>
      ))}
    </Screen>
  );
}
// Retained harness: disconnected from native lookup and application entry points.
const nativeProbe: NativeProbe | null = null;
const transfers: NativeTransfers | null = null;
export function NativeProbeApp() {
  const [showTransfers, setShowTransfers] = useState(false);
  return (
    <SafeAreaProvider>
      {showTransfers ? (
        <NativeTransferScreen
          service={typeof transfers?.executeOperation === "function" ? transfers : null}
          onBack={() => setShowTransfers(false)}
        />
      ) : (
        <NativeProbeScreen service={nativeProbe} onTransfers={() => setShowTransfers(true)} />
      )}
    </SafeAreaProvider>
  );
}
