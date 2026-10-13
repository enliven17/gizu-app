import { useEffect, useState, type ReactNode } from "react";
import { Modal, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import { ErrorNotice } from "@/components/molecules/ErrorNotice";
import { Surface } from "@/components/molecules/Surface";
import { formatSwapAmount } from "@/domain/swap";
import { groupDigits } from "@/domain/wallet/amounts";
import { holdingAmount } from "./SwapHoldingsSection";
import { previewSaleOut } from "./confidentialSwap";
import { BalanceAside, SwapAmount, SwapPanel, TokenPill } from "./components/SwapPanel";
import { DEBUG_SWEEP_ADDRESS, DEBUG_SWEEP_ENABLED } from "./debugSweep";
import { swapDemoEnabled } from "./demo/swapDemo";
import { useSwapHoldings } from "./useSwapHoldings";

/** Sells a held token's whole balance back to Monad USDC, the only destination of a sale. */
export function SwapSellForm({ flip, onSettled }: { flip: ReactNode; onSettled: () => void }) {
  const holdings = useSwapHoldings(onSettled);
  const list = holdings.snapshot?.holdings ?? [];
  const [chosen, setChosen] = useState("");
  const [choosing, setChoosing] = useState(false);
  const holding = list.find((item) => item.token === chosen) ?? list[0];
  const batch = holding?.batches[0];
  const [estimate, setEstimate] = useState<{ key: string; atoms: string } | null>(null);
  const estimateKey = holding ? `${holding.token}:${holding.balanceAtoms}` : "";
  useEffect(() => {
    if (!holding) return;
    let live = true;
    previewSaleOut(holding.token, holding.balanceAtoms)
      .then((atoms) => {
        if (live) setEstimate({ key: estimateKey, atoms });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [holding, estimateKey]);
  const received = estimate?.key === estimateKey ? estimate.atoms : null;
  return (
    <>
      <Surface>
        <View className="gap-1 p-2">
          <SwapPanel
            label="You pay"
            aside={
              holding ? (
                <BalanceAside
                  text={`Balance ${holdingAmount(holding.balanceAtoms, holding.decimals)}`}
                />
              ) : null
            }
            amount={
              <SwapAmount
                value={holding ? holdingAmount(holding.balanceAtoms, holding.decimals) : "0"}
                muted={!holding}
              />
            }
            token={
              <TokenPill
                symbol={holding?.symbol ?? null}
                accessibilityLabel="Choose token to sell"
                disabled={holdings.busy || list.length < 2}
                onPress={list.length > 1 ? () => setChoosing(true) : undefined}
              />
            }
          />
          {flip}
          <SwapPanel
            label="You receive"
            amount={
              <SwapAmount
                value={received ? groupDigits(formatSwapAmount(BigInt(received))) : "0"}
                muted={!received}
              />
            }
            token={<TokenPill symbol="USDC" />}
          />
        </View>
      </Surface>
      <Button
        label={
          holdings.busy
            ? "Working"
            : !holding
              ? "No tokens to swap"
              : swapDemoEnabled()
                ? "Swap"
                : `Sell ${holding.symbol} for USDC`
        }
        disabled={holdings.busy || !!holdings.error || holdings.saleFailed || !batch}
        onPress={() => {
          if (batch) void holdings.sell(batch.id);
        }}
      />
      {holdings.error ? (
        <ErrorNotice
          kind="holdings"
          message="Couldn’t refresh your holdings."
          stale={!!holdings.snapshot}
          actionLabel="Retry holdings"
          busy={holdings.busy}
          onAction={() => void holdings.retryRead()}
        />
      ) : null}
      {holdings.saleFailed ? (
        <ErrorNotice
          kind="sale"
          message="Couldn’t finish the sale. Check its status in Swap before trying again."
          actionLabel="Check status"
          onAction={onSettled}
          busy={holdings.busy}
        />
      ) : null}
      {holding && !batch ? (
        <Typography variant="micro" className="text-center">
          This balance can’t be sold yet. Refresh to try again.
        </Typography>
      ) : null}
      {DEBUG_SWEEP_ENABLED && !swapDemoEnabled() ? (
        <Button
          label={`Debug: send ${holding?.symbol ?? "token"} proceeds to ${DEBUG_SWEEP_ADDRESS.slice(0, 6)}…${DEBUG_SWEEP_ADDRESS.slice(-4)}`}
          variant="quiet"
          disabled={holdings.busy || !!holdings.error || holdings.saleFailed || !batch}
          onPress={() => {
            if (batch) void holdings.sweep(batch.id);
          }}
        />
      ) : null}
      <Modal
        visible={choosing}
        transparent
        animationType="fade"
        onRequestClose={() => setChoosing(false)}
      >
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Close token list"
          onPress={() => setChoosing(false)}
          className="flex-1 justify-end bg-black/60"
        >
          <View className="gap-2 rounded-t-[28px] bg-card px-5 pb-10 pt-5">
            <Typography variant="cardTitle" className="pb-1">
              Choose a token
            </Typography>
            {list.map((item) => (
              <PressableScale
                key={item.token}
                accessibilityRole="radio"
                accessibilityLabel={item.symbol}
                accessibilityState={{ checked: item.token === holding?.token }}
                onPress={() => {
                  setChosen(item.token);
                  setChoosing(false);
                }}
                className={`flex-row items-center justify-between rounded-2xl px-4 py-4 ${item.token === holding?.token ? "bg-neon/10" : "bg-well"}`}
              >
                <Typography
                  variant="rowTitle"
                  className={item.token === holding?.token ? "!text-neon" : ""}
                >
                  {item.symbol}
                </Typography>
                <Typography variant="caption">
                  {holdingAmount(item.balanceAtoms, item.decimals)}
                </Typography>
              </PressableScale>
            ))}
          </View>
        </PressableScale>
      </Modal>
    </>
  );
}
