import { useOptionalMainnetWallet } from "@/features/wallet/MainnetWalletProvider";
import { TextInput, View } from "react-native";
import { ArrowDown } from "lucide-react-native";
import { Button } from "@/components/atoms/Button";
import { HoldingDetails } from "@/components/molecules/HoldingDetails";
import { SwapTokenPicker } from "./SwapTokenPicker";
import { Typography } from "@/components/atoms/Typography";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { Screen } from "@/components/templates/Screen";
import { formatSwapAmount } from "@/domain/swap";
import { groupDigits } from "@/domain/wallet/amounts";
import colors from "@/theme/colors.json";
import { useNativeSwap } from "./useNativeSwap";

export function NativeSwapScreen() {
  const swap = useNativeSwap();
  const wallet = useOptionalMainnetWallet();
  const maxAmount =
    wallet?.snapshot && wallet.snapshot.balanceComplete !== false
      ? formatSwapAmount(BigInt(wallet.snapshot.totalAtoms))
      : null;
  const selected = swap.tokens.find((token) => token.address === swap.target);
  const active =
    swap.status !== null && swap.status.phase !== "COMPLETE" && swap.status.phase !== "CANCELLED";
  const refunded = swap.status?.phase === "PAUSED" && swap.status.pausedCode === "FUNDING_REFUNDED";
  return (
    <Screen
      refreshing={swap.busy}
      onRefresh={() => {
        if (!swap.busy) void swap.refresh();
      }}
    >
      <View className="gap-1 pb-1">
        <Typography variant="pageTitle" className="!text-[26px]">
          Swap
        </Typography>
        <Typography variant="micro">Buy tokens with USDC.</Typography>
      </View>
      {swap.status ? (
        <Surface>
          <View className="gap-2 px-5 py-5">
            <Typography variant="cardTitle">
              {swap.status.phase === "COMPLETE"
                ? "Swap completed"
                : swap.status.phase === "CANCELLED"
                  ? "Swap cancelled"
                  : swap.status.phase === "PAUSED"
                    ? "Swap paused"
                    : "Swap in progress"}
            </Typography>
            <Typography variant="caption">
              {swap.status.direction === "sell" ? "Selling" : "Buying"}{" "}
              {swap.status.targetSymbol || "tokens"}
            </Typography>
            <HoldingDetails label="Swap details" accessibilityLabel="Swap details">
              <Typography variant="micro">{swap.status.phase}</Typography>
              <Typography variant="micro">
                {swap.status.direction === "sell" ? "Sell" : "Buy"} ·{" "}
                {swap.status.targetSymbol || "Target"} · step {swap.status.step || "—"}
                {swap.status.pausedCode ? ` · ${swap.status.pausedCode}` : ""}
              </Typography>
              <Typography variant="micro">
                Payouts {swap.status.payoutsSubmitted} · orders {swap.status.ordersComplete}
              </Typography>
              {/^[1-9]\d*$/.test(swap.status.creditedAtoms) ? (
                <Typography variant="micro">
                  Private balance · {formatSwapAmount(BigInt(swap.status.creditedAtoms))} USDC
                </Typography>
              ) : null}
              {swap.status.returnAddresses.length > 0 ? (
                <Typography variant="micro">
                  Return wallets{"\n"}
                  {swap.status.returnAddresses.join("\n")}
                </Typography>
              ) : null}
            </HoldingDetails>
          </View>
        </Surface>
      ) : null}
      {swap.canSell ? (
        <Typography variant="micro">
          Your purchased tokens are also available under Token holdings on Home.
        </Typography>
      ) : null}
      {!active && (
        <>
          <Surface>
            <View className="gap-1.5 p-2">
              <View className="gap-3 rounded-[20px] bg-well p-4">
                <View className="flex-row flex-wrap items-center justify-between gap-2">
                  <Typography variant="label11">You pay</Typography>
                  {wallet && (
                    <Typography variant="micro">
                      {wallet.snapshot && wallet.snapshot.balanceComplete !== false
                        ? `Available${wallet.error || wallet.snapshot.stale ? " (cached)" : ""}: ${groupDigits(formatSwapAmount(BigInt(wallet.snapshot.totalAtoms)))} USDC`
                        : "Checking available USDC…"}
                    </Typography>
                  )}
                </View>
                <View className="flex-row items-center gap-3">
                  <TextInput
                    accessibilityLabel="Amount in USDC"
                    value={swap.amount}
                    onChangeText={swap.setAmount}
                    editable={!swap.busy}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={colors.fg["20"]}
                    maxLength={21}
                    className="font-sans min-h-14 flex-1 text-[36px] text-text"
                    style={{ fontVariant: ["tabular-nums"] }}
                  />
                  <Typography variant="rowTitle" className="!text-fg-55">
                    USDC
                  </Typography>
                  <Button
                    label="Max"
                    accessibilityLabel="Use maximum USDC amount"
                    variant="quiet"
                    disabled={swap.busy || maxAmount === null}
                    onPress={() => {
                      if (maxAmount !== null) swap.setAmount(maxAmount);
                    }}
                  />
                </View>
              </View>
              <View
                className="z-10 -my-4 h-9 w-9 items-center justify-center self-center rounded-full border border-cardEdge bg-card"
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              >
                <ArrowDown size={16} color={colors.fg["70"]} />
              </View>
              <SwapTokenPicker
                tokens={swap.tokens}
                target={swap.target}
                disabled={swap.busy}
                onSelect={swap.selectToken}
              />
            </View>
          </Surface>
          <Button
            label={swap.busy ? "Working" : "Review swap"}
            onPress={swap.start}
            disabled={!swap.canStart}
          />
        </>
      )}
      {swap.error ? <Notice message={swap.error} error /> : null}
      {active ? (
        <View className="gap-3">
          <Button
            label={swap.busy ? "Working" : "Resume"}
            onPress={swap.resume}
            disabled={swap.busy}
          />
          {swap.status?.approved && !refunded ? (
            <Typography variant="micro" className="px-1 text-center">
              Approved steps may already have moved funds, so this swap can only be resumed.
            </Typography>
          ) : (
            <Button
              label="Cancel swap"
              variant="secondary"
              onPress={swap.cancel}
              disabled={swap.busy}
            />
          )}
        </View>
      ) : (
        <View className="gap-3">
          {swap.canRecover ? (
            <Button
              label={
                swap.busy ? "Working" : `Finish unfinished buys as ${selected?.symbol ?? "token"}`
              }
              variant="secondary"
              onPress={swap.recover}
              disabled={swap.busy}
            />
          ) : null}
          {swap.canPayout ? (
            <Button
              label={
                swap.busy ? "Working" : `Buy ${selected?.symbol ?? "token"} with private balance`
              }
              onPress={swap.payout}
              disabled={swap.busy}
            />
          ) : null}
          {swap.canSell ? (
            <Button
              label={swap.busy ? "Working" : "Sell back to Monad USDC"}
              onPress={swap.sell}
              disabled={swap.busy}
            />
          ) : null}
        </View>
      )}
    </Screen>
  );
}
