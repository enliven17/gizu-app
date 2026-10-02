import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { EarnIntent, EarnPrivateBalance } from "@/domain/earn/types";
import { formatUsdc } from "@/domain/wallet/amounts";
import { useEarn } from "./EarnProvider";
export function PrivateBalancePanel({ intent }: { intent: EarnIntent }) {
  const { privateBalance } = useEarn();
  const [balance, setBalance] = useState<EarnPrivateBalance | null>(null);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active = useRef(0),
    pending = useRef(false);
  useEffect(() => {
    const attempt = ++active.current;
    return () => {
      active.current = attempt + 1;
      if (pending.current) privateBalance.cancel();
    };
  }, [privateBalance]);
  async function check() {
    if (pending.current) return;
    pending.current = true;
    const attempt = active.current;
    setBusy(true);
    setMessage("");
    setBalance(null);
    try {
      const next = await privateBalance.read(intent);
      if (active.current === attempt) setBalance(next);
    } catch (error) {
      if (active.current === attempt)
        setMessage(error instanceof Error ? error.message : "Confidential balance unavailable.");
    } finally {
      pending.current = false;
      if (active.current === attempt) setBusy(false);
    }
  }
  return (
    <Surface>
      <View className="gap-3 p-5">
        <Typography variant="row">Confidential USDC</Typography>
        <Typography variant="caption">
          Authenticate with your passkey to check the private balance. This does not transfer funds.
        </Typography>
        <Button
          label="Check confidential balance"
          variant="secondary"
          loading={busy}
          onPress={() => void check()}
        />
        {balance && (
          <Typography>
            Authenticated private balance: {formatUsdc(balance.available)} USDC
          </Typography>
        )}
        <Typography variant="caption">
          This account balance does not confirm credit for a specific deposit or return. Funding and
          cycle completion require separate settlement evidence.
        </Typography>
        {message !== "" && <Typography accessibilityRole="alert">{message}</Typography>}
      </View>
    </Surface>
  );
}
