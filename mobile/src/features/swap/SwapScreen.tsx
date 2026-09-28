import { View } from "react-native";
import { ArrowRight } from "lucide-react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { Screen } from "@/components/templates/Screen";
import { formatSwapAmount, parseSwapAmount, swapAssets, type SwapService } from "@/domain/swap";
import { BubbleUpButton } from "@/features/access/components/BubbleUpButton";
import { sectionDelay } from "@/theme/motion";
import { AssetPicker } from "./components/AssetPicker";
import { DirectionMarker, PayCard, ReceiveCard } from "./components/SwapCards";
import { SwapResult } from "./components/SwapResult";
import { QuoteRows, SheetAmount, SwapSheet } from "./components/SwapSheet";
import { useSwapController } from "./useSwapController";

type Swap = ReturnType<typeof useSwapController>;

function ErrorNotice({ swap }: { swap: Swap }) {
  return swap.error ? <Notice message={swap.error} error /> : null;
}

function EditStep({ swap }: { swap: Swap }) {
  const asset = swapAssets.find((item) => item.symbol === swap.symbol);
  const value = parseSwapAmount(swap.amount);
  const estimate = value !== null && asset ? formatSwapAmount(value / asset.price) : "0";
  return (
    <>
      <FadeIn delay={sectionDelay(1)} className="gap-1">
        <PayCard
          amount={swap.amount}
          available={`Available: ${formatSwapAmount(swap.balance)} USDG (mock)`}
          editable={!swap.busy}
          onChange={swap.setAmount}
          onQuickFill={(p) => swap.setAmount(formatSwapAmount((swap.balance * BigInt(p)) / 100n))}
        />
        <DirectionMarker />
        <ReceiveCard estimate={estimate} symbol={swap.symbol} name={asset?.name ?? ""} />
      </FadeIn>
      <FadeIn delay={sectionDelay(2)}>
        <AssetPicker
          assets={swapAssets}
          selected={swap.symbol}
          disabled={swap.busy}
          onSelect={swap.setSymbol}
        />
      </FadeIn>
      <FadeIn delay={sectionDelay(3)} className="gap-4">
        <View className="rounded-3xl border border-glassBorder bg-glass px-5 py-5">
          <QuoteRows
            rows={[
              ["Rate", asset ? `1 ${asset.symbol} = ${asset.price.toString()} USDG` : "—"],
              ["Network preview", "Robinhood Chain"],
              ["Fees", "Not modeled"],
            ]}
          />
        </View>
        {swap.amount !== "" && swap.validation ? <Notice message={swap.validation} error /> : null}
        <ErrorNotice swap={swap} />
        <BubbleUpButton
          label={swap.busy ? "Getting quote" : "Review swap"}
          icon={ArrowRight}
          disabled={!!swap.validation || swap.busy}
          onPress={swap.review}
        />
      </FadeIn>
    </>
  );
}

function ReviewStep({ swap, quote }: { swap: Swap; quote: NonNullable<Swap["quote"]> }) {
  const name = swapAssets.find((item) => item.symbol === quote.symbol)?.name ?? quote.symbol;
  return (
    <SwapSheet>
      <View className="flex-row items-center gap-3">
        <View className="min-h-10 min-w-10 items-center justify-center rounded-xl bg-neon/10 px-2.5">
          <Typography variant="eyebrow" className="!font-bold !text-neon">
            {quote.symbol}
          </Typography>
        </View>
        <View className="min-w-0 flex-1">
          <Typography variant="section">Review swap</Typography>
          <Typography variant="micro">{name}</Typography>
        </View>
      </View>
      <View className="gap-1">
        <SheetAmount label="You pay" value={`${quote.input} USDG`} />
        <DirectionMarker />
        <SheetAmount label="Expected output" value={`${quote.output} ${quote.symbol}`} />
      </View>
      <QuoteRows
        rows={[
          ["Minimum output", `${quote.minimum} ${quote.symbol}`],
          ["Network preview", "Robinhood Chain"],
        ]}
      />
      <Typography variant="micro" className="px-1">
        Sample quote, valid 60 seconds. No passkey approval.
      </Typography>
      <ErrorNotice swap={swap} />
      <Button label="Simulate swap" loading={swap.busy} onPress={swap.confirm} />
      <Button label="Back to amount" variant="secondary" disabled={swap.busy} onPress={swap.edit} />
    </SwapSheet>
  );
}

function OrderStep({ swap, order }: { swap: Swap; order: NonNullable<Swap["order"]> }) {
  const filled = order.status === "filled";
  return (
    <FadeIn className="gap-4">
      <SwapResult filled={filled} />
      <View className="rounded-3xl border border-glassBorder bg-glass px-5 py-5">
        <QuoteRows
          rows={[
            ["You paid", `${order.quote.input} USDG`],
            [
              filled ? "You received" : "Expected output",
              `${order.quote.output} ${order.quote.symbol}`,
            ],
            ["Status", filled ? "Completed (mock)" : "Pending (mock)"],
          ]}
        />
      </View>
      <Typography variant="micro" className="px-1 text-center">
        Tokens stay in the simulated wallet.
      </Typography>
      <ErrorNotice swap={swap} />
      {filled ? (
        <Button label="New swap" onPress={swap.reset} />
      ) : (
        <Button label="Refresh simulated status" loading={swap.busy} onPress={swap.refresh} />
      )}
    </FadeIn>
  );
}

function Activity({ swap }: { swap: Swap }) {
  const holdings = swapAssets
    .map((asset) => ({
      symbol: asset.symbol,
      amount: swap.history
        .filter((order) => order.status === "filled" && order.quote.symbol === asset.symbol)
        .reduce((sum, order) => sum + parseSwapAmount(order.quote.output)!, 0n),
    }))
    .filter((asset) => asset.amount > 0n);
  return (
    <>
      {holdings.length > 0 && (
        <FadeIn delay={sectionDelay(4)} className="mt-5 gap-4">
          <Typography variant="section">Holdings</Typography>
          <Surface>
            {holdings.map((asset, index) => (
              <GroupedRow
                key={asset.symbol}
                label={asset.symbol}
                value={formatSwapAmount(asset.amount)}
                last={index === holdings.length - 1}
              />
            ))}
          </Surface>
        </FadeIn>
      )}
      {swap.history.length > 0 && (
        <FadeIn delay={sectionDelay(5)} className="mt-5 gap-4">
          <Typography variant="section">Recent</Typography>
          <Surface>
            {swap.history.map((item, index) => (
              <GroupedRow
                key={item.id}
                label={`${item.quote.input} USDG → ${item.quote.symbol}`}
                value={item.status === "filled" ? "Completed" : "Pending"}
                detail={item.id}
                last={index === swap.history.length - 1}
              />
            ))}
          </Surface>
        </FadeIn>
      )}
    </>
  );
}

export function SwapScreen({ service }: { service?: SwapService }) {
  const swap = useSwapController(service);
  const { order, quote } = swap;
  return (
    <Screen>
      <FadeIn className="gap-1">
        <Typography variant="pageTitle">Swap</Typography>
        <Typography variant="micro">Preview with mock data. No funds move.</Typography>
      </FadeIn>
      {order ? (
        <OrderStep swap={swap} order={order} />
      ) : quote ? (
        <ReviewStep swap={swap} quote={quote} />
      ) : (
        <EditStep swap={swap} />
      )}
      <Activity swap={swap} />
    </Screen>
  );
}
