import { TextInput, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { Screen } from "@/components/templates/Screen";
import { formatSwapAmount } from "@/domain/swap";
import colors from "@/theme/colors.json";
import { useNativeSwap } from "./useNativeSwap";

export function NativeSwapScreen() {
  const swap = useNativeSwap();
  const selected = swap.tokens.find((token) => token.address === swap.target);
  const active =
    swap.status !== null && swap.status.phase !== "COMPLETE" && swap.status.phase !== "CANCELLED";
  const refunded = swap.status?.phase === "PAUSED" && swap.status.pausedCode === "FUNDING_REFUNDED";
  return (
    <Screen>
      <View className="gap-1">
        <Typography variant="pageTitle">Swap</Typography>
        <Typography variant="micro">
          Monad USDC bridges through Aurora to Robinhood USDG on three fresh wallets, then buys the
          selected token. After a fill you can sell it back; proceeds return through three new Monad
          wallets.
        </Typography>
      </View>
      <Surface>
        <View className="gap-2 px-5 py-5">
          <Typography variant="section">Funding wallet</Typography>
          <Typography variant="micro">
            {swap.fundingAddress || "Open the wallet to see the USDC deposit address."}
          </Typography>
        </View>
      </Surface>
      {swap.status ? (
        <Surface>
          <View className="gap-2 px-5 py-5">
            <Typography variant="section">{swap.status.phase}</Typography>
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
          <View className="gap-3 rounded-[28px] border border-glassBorder bg-glass px-6 py-6">
            <Typography variant="micro">You pay · maximum 10 USDC</Typography>
            <TextInput
              accessibilityLabel="Amount in USDC"
              value={swap.amount}
              onChangeText={swap.setAmount}
              editable={!swap.busy}
              keyboardType="decimal-pad"
              placeholder="0"
              placeholderTextColor={colors.fg["20"]}
              maxLength={12}
              className="font-sans min-h-14 text-[40px] text-text"
            />
          </View>
          <View className="flex-row flex-wrap gap-2">
            {swap.tokens.map((token) => (
              <PressableScale
                key={token.address}
                accessibilityRole="radio"
                accessibilityLabel={`${token.symbol} · ${token.name}`}
                accessibilityState={{ checked: token.address === swap.target, disabled: swap.busy }}
                disabled={swap.busy}
                onPress={() => swap.setTarget(token.address)}
                className={`min-h-11 justify-center rounded-2xl border px-4 ${token.address === swap.target ? "border-neon/25 bg-neon/10" : "border-borderSoft bg-glassSoft"}`}
              >
                <Typography
                  variant="eyebrow"
                  className={token.address === swap.target ? "!text-neon" : ""}
                >
                  {token.symbol}
                </Typography>
              </PressableScale>
            ))}
          </View>
          {selected ? <Typography variant="micro">{selected.name}</Typography> : null}
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
          <Button
            label={swap.busy ? "Working" : "Start swap"}
            onPress={swap.start}
            disabled={!swap.canStart}
          />
        </View>
      )}
      <Button label="Refresh" variant="quiet" onPress={swap.refresh} disabled={swap.busy} />
    </Screen>
  );
}
