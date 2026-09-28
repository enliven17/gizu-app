import { WalletOperations } from "@/features/wallet/WalletOperations";
import { ArrowUpRight, ShieldCheck } from "lucide-react-native";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { useCallback } from "react";
import { Keyboard, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import { BackAction } from "@/navigation/BackAction";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { AccountAddress } from "@/features/account/AccountAddress";
import { useWallet } from "@/features/wallet/WalletProvider";
import { WalletHistoryRows } from "@/features/wallet/WalletHistoryRows";
import colors from "@/theme/colors.json";

export function NativeTransaction({
  route,
}: NativeStackScreenProps<RootStackParamList, "Transaction">) {
  const wallet = useWallet();
  const c = wallet.transfers;
  const kind = route.params.kind;
  const { refresh } = c;
  useFocusEffect(
    useCallback(() => {
      if (kind === "withdraw") void refresh();
    }, [kind, refresh]),
  );
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="title">
        {kind === "deposit"
          ? "Deposit"
          : kind === "withdraw"
            ? "Withdraw"
            : "Investment unavailable"}
      </Typography>
      <Typography variant="caption">Monad testnet · Account 0</Typography>
      {kind === "deposit" ? (
        <>
          <Typography>
            Receive testnet MON at your wallet address. This does not invest in a vault.
          </Typography>
          <Surface>
            <View className="pt-5">
              <AccountAddress />
            </View>
          </Surface>
          <Typography>
            Incoming transfers are not indexed here. Refresh your balance after funding.
          </Typography>
          <Button
            label="Refresh balance"
            disabled={wallet.loading}
            onPress={() => void wallet.refresh()}
          />
          <Typography>
            {wallet.loading
              ? "Loading balance…"
              : wallet.error
                ? "Balance unavailable. Please retry."
                : wallet.balance + " MON"}
          </Typography>
        </>
      ) : kind === "withdraw" ? (
        <>
          <Surface>
            <View className="gap-4 p-5">
              <View className="flex-row items-center justify-between gap-3">
                <Typography variant="label">SEND MON</Typography>
                <View className="rounded-2xl bg-accent/10 p-3">
                  <ArrowUpRight size={22} color={colors.accent} accessible={false} />
                </View>
              </View>
              <Typography variant="caption">Amount to withdraw</Typography>
              <View className="flex-row items-center gap-3">
                <TextInput
                  accessibilityLabel="Amount in MON"
                  value={c.amount}
                  onChangeText={c.setAmount}
                  editable={!c.busy}
                  keyboardType="decimal-pad"
                  maxLength={40}
                  placeholder="0.00"
                  placeholderTextColor={colors.muted}
                  className="min-h-16 min-w-0 flex-1 text-4xl text-text"
                />
                <Typography variant="value">MON</Typography>
              </View>
              <View className="gap-1 border-t border-border pt-4">
                <Typography variant="caption">
                  {wallet.loading
                    ? "Loading available balance…"
                    : wallet.error
                      ? "Available balance unavailable"
                      : "Available: " + wallet.balance + " MON"}
                </Typography>
                <Typography variant="caption">Maximum 0.1 testnet MON per transfer</Typography>
              </View>
            </View>
          </Surface>
          <View className="gap-3">
            <Typography variant="row">Send to</Typography>
            <Surface>
              <View className="gap-2 p-5">
                <Typography variant="caption">Recipient address</Typography>
                <TextInput
                  accessibilityLabel="Recipient address"
                  value={c.recipient}
                  onChangeText={c.setRecipient}
                  editable={!c.busy}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={42}
                  placeholder="0x…"
                  placeholderTextColor={colors.muted}
                  className="min-h-14 text-base text-text"
                />
              </View>
            </Surface>
          </View>
          <Surface>
            <GroupedRow label="From" value="Account 0" />
            <View className="px-5 pb-4">
              <Typography selectable variant="caption">
                {wallet.session.address}
              </Typography>
            </View>
            <GroupedRow label="Network" value="Monad testnet" />
            <GroupedRow label="Network fee" value="Calculated in native review" />
          </Surface>
          <View className="flex-row items-start gap-3 px-1">
            <ShieldCheck size={20} color={colors.accent} accessible={false} />
            <View className="min-w-0 flex-1 gap-1">
              <Typography variant="row">Review before you approve</Typography>
              <Typography variant="caption">
                Review the exact recipient, amount and fees, then approve with this wallet’s
                passkey. Nothing is signed before native approval.
              </Typography>
            </View>
          </View>
          <Button
            label="Review withdrawal"
            loading={c.busy}
            disabled={c.busy || !c.ready || c.history.blocked}
            onPress={() => {
              Keyboard.dismiss();
              void c.send();
            }}
          />
          <Typography variant="caption">
            Closing this page does not undo a submitted transfer.
          </Typography>
          {c.message !== "" && (
            <Typography accessibilityLiveRegion="polite">{c.message}</Typography>
          )}
          <Button
            label="Check status"
            variant="secondary"
            disabled={c.busy}
            onPress={() => void c.refresh()}
          />
          {c.history.entries.length > 0 && (
            <Typography variant="heading">Recent withdrawals</Typography>
          )}
          <WalletOperations />
          <WalletHistoryRows entries={c.history.entries} />
        </>
      ) : (
        <Typography>Vault buy/sell is not connected to your wallet.</Typography>
      )}
    </Screen>
  );
}
