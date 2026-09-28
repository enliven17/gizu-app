import { WalletOperations } from "@/features/wallet/WalletOperations";
import { useCallback } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { BackAction } from "@/navigation/BackAction";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { useWallet } from "@/features/wallet/WalletProvider";
import { WalletHistoryRows } from "@/features/wallet/WalletHistoryRows";

export function NativeActivity() {
  const wallet = useWallet();
  const c = wallet.transfers;
  const { refresh } = c;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="heading">Activity</Typography>
      <Typography variant="caption">
        Monad testnet · Outgoing transfers recorded by this app on this device. Incoming deposits
        and external activity are not indexed.
      </Typography>
      <Button label="Refresh activity" disabled={c.busy} onPress={() => void c.refresh()} />
      {c.message !== "" && <Typography accessibilityLiveRegion="polite">{c.message}</Typography>}
      {c.ready && c.history.entries.length === 0 && (
        <Typography>No outgoing transfers recorded for this wallet.</Typography>
      )}
      <WalletOperations />
      <WalletHistoryRows entries={c.history.entries} />
    </Screen>
  );
}
