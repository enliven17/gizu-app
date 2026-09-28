import { WalletTransfers } from "./WalletTransfers";
import { nativeWalletTransfers } from "@/development/legacySigner/transfers";
import { type WalletTransferService } from "@/domain/wallet/types";
import { View } from "react-native";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { Screen } from "@/components/templates/Screen";
import { Notice } from "@/components/molecules/Notice";
import { clipboardService, type ClipboardService } from "@/services/clipboard";
import { monadBalanceService, type WalletBalanceService } from "@/services/wallet/balance";
import { useSession } from "@/application/SessionProvider";
import type { WalletSession } from "@/services/access";
import { useWalletController } from "@/features/wallet/useWalletController";

export type WalletDependencies = {
  balance?: WalletBalanceService;
  clipboard?: ClipboardService;
  transfers?: WalletTransferService;
};
export function WalletScreen({
  session,
  dependencies = {},
}: {
  session: WalletSession;
  dependencies?: WalletDependencies;
}) {
  const { disconnect } = useSession();
  const c = useWalletController(
    session.address,
    dependencies.balance ?? monadBalanceService,
    dependencies.clipboard ?? clipboardService,
  );
  return (
    <Screen>
      <GizuLogo />
      <Typography variant="title">Your wallet</Typography>
      <Typography>Monad testnet · Account 0</Typography>
      <Notice message="Testnet MON only. This balance is separate from the investment demo and has no real monetary value." />
      <Surface>
        <View className="gap-4 p-5">
          <Typography variant="caption">Available testnet balance</Typography>
          {c.loading ? (
            <Typography accessibilityLiveRegion="polite">Loading testnet balance…</Typography>
          ) : c.error ? (
            <Notice error message="Could not load the testnet balance. Try refreshing." />
          ) : c.balance !== null ? (
            <Typography variant="title">{c.balance} MON</Typography>
          ) : null}
          <Button
            label="Refresh balance"
            variant="secondary"
            disabled={c.loading}
            onPress={() => void c.refresh()}
          />
        </View>
      </Surface>
      <Typography>Wallet address</Typography>
      <Typography selectable accessibilityLabel={`Wallet address: ${session.address}`}>
        {session.address}
      </Typography>
      <Button
        label="Copy wallet address"
        variant="secondary"
        loading={c.copied === "pending"}
        onPress={() => void c.copy()}
      />
      {c.copied === "done" && (
        <Typography accessibilityLiveRegion="polite">Wallet address copied.</Typography>
      )}
      {c.copied === "failed" && <Notice error message="Could not copy the address. Try again." />}
      <Typography variant="caption">
        Your wallet is open for viewing. Transfers require a separate passkey unlock and approval.
      </Typography>
      <WalletTransfers
        address={session.address}
        service={dependencies.transfers ?? nativeWalletTransfers}
        onSettled={c.refresh}
      />
      <Button label="Disconnect wallet" variant="quiet" onPress={disconnect} />
    </Screen>
  );
}
