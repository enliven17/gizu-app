import { TextInput, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { Choice } from "@/components/molecules/Choice";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { Screen } from "@/components/templates/Screen";
import { formatSwapAmount, parseSwapAmount, swapAssets, type SwapService } from "@/domain/swap";
import colors from "@/theme/colors.json";
import { useSwapController } from "./useSwapController";

export function SwapScreen({ service }: { service?: SwapService }) {
  const swap = useSwapController(service);
  const holdings = swapAssets
    .map((asset) => ({
      symbol: asset.symbol,
      amount: swap.history
        .filter((order) => order.status === "filled" && order.quote.symbol === asset.symbol)
        .reduce((sum, order) => sum + parseSwapAmount(order.quote.output)!, 0n),
    }))
    .filter((asset) => asset.amount > 0n);
  return (
    <Screen>
      <Typography variant="title">Swap</Typography>
      <Notice message="Preview with mock data. Prices, USDG and orders are simulated; no funds move. Resets when this session ends." />
      {swap.order ? (
        <>
          <Typography variant="heading">
            {swap.order.status === "filled" ? "Swap simulated" : "Simulation pending"}
          </Typography>
          <Surface>
            <GroupedRow label="You paid" value={`${swap.order.quote.input} USDG`} />
            <GroupedRow
              label={swap.order.status === "filled" ? "You received" : "Expected output"}
              value={`${swap.order.quote.output} ${swap.order.quote.symbol}`}
            />
            <GroupedRow
              label="Status"
              value={swap.order.status === "filled" ? "Completed (mock)" : "Pending (mock)"}
            />
          </Surface>
          <Typography>
            Purchased tokens stay in the simulated source wallet. No consolidation or distribution
            is performed.
          </Typography>
          {swap.order.status === "pending" ? (
            <Button label="Refresh simulated status" loading={swap.busy} onPress={swap.refresh} />
          ) : (
            <Button label="New swap" onPress={swap.reset} />
          )}
        </>
      ) : swap.quote ? (
        <>
          <Typography variant="heading">Review swap</Typography>
          <Surface>
            <GroupedRow label="Network preview" value="Robinhood Chain" />
            <GroupedRow label="You pay" value={`${swap.quote.input} USDG`} />
            <GroupedRow
              label="Expected output"
              value={`${swap.quote.output} ${swap.quote.symbol}`}
            />
            <GroupedRow
              label="Minimum output"
              value={`${swap.quote.minimum} ${swap.quote.symbol}`}
            />
          </Surface>
          <Typography variant="caption">
            Sample quote expires after 60 seconds. Fees and execution pricing are not modeled. No
            passkey approval is requested for this simulation.
          </Typography>
          <Button label="Simulate swap" loading={swap.busy} onPress={swap.confirm} />
          <Button
            label="Back to amount"
            variant="secondary"
            disabled={swap.busy}
            onPress={swap.edit}
          />
        </>
      ) : (
        <>
          <Typography variant="heading">Buy stock tokens</Typography>
          <Typography>Choose a token to receive</Typography>
          <View className="flex-row flex-wrap gap-3">
            {swapAssets.map((asset) => (
              <Choice
                key={asset.symbol}
                label={`${asset.symbol} · ${asset.name}`}
                selected={swap.symbol === asset.symbol}
                disabled={swap.busy}
                onPress={() => swap.setSymbol(asset.symbol)}
              />
            ))}
          </View>
          <Surface>
            <View className="gap-3 p-5">
              <Typography variant="label">You pay · USDG</Typography>
              <TextInput
                accessibilityLabel="Amount in USDG"
                value={swap.amount}
                onChangeText={swap.setAmount}
                editable={!swap.busy}
                keyboardType="decimal-pad"
                placeholder="0.00"
                placeholderTextColor={colors.muted}
                className="min-h-14 rounded-xl border border-border px-4 py-3 text-3xl text-text"
              />
              <Typography variant="caption">
                Available: {formatSwapAmount(swap.balance)} USDG (mock)
              </Typography>
            </View>
          </Surface>
          {swap.amount !== "" && swap.validation ? (
            <Notice message={swap.validation} error />
          ) : null}
          <Button
            label="Review swap"
            loading={swap.busy}
            disabled={!!swap.validation}
            onPress={swap.review}
          />
        </>
      )}
      {swap.error ? <Notice message={swap.error} error /> : null}
      {holdings.length > 0 && (
        <>
          <Typography variant="heading">Simulated holdings</Typography>
          <Surface>
            {holdings.map((asset) => (
              <GroupedRow
                key={asset.symbol}
                label={asset.symbol}
                value={formatSwapAmount(asset.amount)}
              />
            ))}
          </Surface>
        </>
      )}
      {swap.history.length > 0 && (
        <>
          <Typography variant="heading">Simulated activity</Typography>
          <Surface>
            {swap.history.map((item) => (
              <GroupedRow
                key={item.id}
                label={`${item.quote.input} USDG → ${item.quote.symbol}`}
                value={item.status === "filled" ? "Completed" : "Pending"}
                detail={item.id}
              />
            ))}
          </Surface>
        </>
      )}
    </Screen>
  );
}
