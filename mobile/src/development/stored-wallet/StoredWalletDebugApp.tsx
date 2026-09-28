import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import {
  storedSignerIdentity,
  type StoredSignerContract,
  type StoredWalletState,
} from "@/domain/wallet/storedSigner";

type Probe = Pick<StoredSignerContract, "getWalletState" | "createWallet" | "openWallet" | "lock">;
export function StoredWalletDebugScreen({ service }: { service: Probe | null }) {
  const [state, setState] = useState<StoredWalletState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Refresh state to begin.");
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      service?.lock();
    };
  }, [service]);
  async function run(action: "getWalletState" | "createWallet" | "openWallet") {
    if (!service || pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result = await service[action]();
      if (!mounted.current) return;
      setState(result);
      setMessage(
        action === "openWallet" && result.status === "backupRequired"
          ? "Passkey verified. Wallet still requires backup."
          : action === "createWallet"
            ? "Wallet created and encrypted. Backup is required."
            : "Wallet state refreshed.",
      );
    } catch {
      if (mounted.current) {
        setState(null);
        setMessage(
          "Operation cancelled or failed. Refresh state before retrying; do not create another wallet blindly.",
        );
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <Screen>
      <Typography variant="title">Stored wallet — phase 2</Typography>
      <Typography>
        Development test only. No funding or transfers. Use normal app onboarding for verified
        backup and recovery.
      </Typography>
      <Typography>
        {service ? message : "Android native module unavailable. Install the phase 2 build."}
      </Typography>
      <Typography>State: {state?.status ?? "not checked"}</Typography>
      {state && "walletId" in state && <Typography>Wallet ID: {state.walletId}</Typography>}
      <Button
        label="Refresh wallet state"
        disabled={!service || busy}
        onPress={() => void run("getWalletState")}
      />
      <Button
        label="Create test wallet"
        disabled={!service || busy || state?.status !== "absent"}
        onPress={() => void run("createWallet")}
      />
      <Button
        label="Open existing wallet"
        disabled={
          !service || busy || (state?.status !== "backupRequired" && state?.status !== "ready")
        }
        onPress={() => void run("openWallet")}
      />
      {busy && <Button label="Cancel operation" onPress={() => service?.lock()} />}
      <Typography>
        Creation leaves backupRequired with the same wallet ID. Normal onboarding verifies backup
        before ready. This diagnostic does not open an app session.
      </Typography>
    </Screen>
  );
}
const service =
  __DEV__ && Platform.OS === "android"
    ? requireOptionalNativeModule<Probe>(storedSignerIdentity.moduleName)
    : null;
export function StoredWalletDebugApp() {
  return (
    <SafeAreaProvider>
      <StoredWalletDebugScreen service={service} />
    </SafeAreaProvider>
  );
}
