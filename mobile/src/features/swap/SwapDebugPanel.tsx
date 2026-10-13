import { useCallback, useState } from "react";
import { Linking, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { HoldingDetails } from "@/components/molecules/HoldingDetails";
import { Surface } from "@/components/molecules/Surface";
import { formatSwapAmount } from "@/domain/swap";
import { swapGateway, swapSigner } from "./confidentialSwap";

/** Debug builds only. Shows which provider route a stalled swap waits on and asks it directly. */
export const SWAP_DEBUG_ENABLED = __DEV__;

type Route = {
  kind?: string;
  provider?: string;
  chain?: string;
  depositAddress?: string;
  depositMemo?: string | null;
  amountIn?: string;
  minAmountOut?: string;
  deadlineMs?: number;
  orderHash?: string | null;
  expirationMs?: number;
};
type Debug = {
  step?: string;
  createdMs?: number;
  authorizationUntilMs?: number;
  waitUntilMs?: number;
  failures?: number;
  resubmits?: number;
  route?: Route | null;
};

/** What a provider route status means for the user, in words. */
const meaning: Record<string, string> = {
  PENDING_DEPOSIT: "Aurora has not seen the deposit yet.",
  KNOWN_DEPOSIT_TX: "Aurora has seen the deposit transaction.",
  PROCESSING: "Aurora has the deposit and is settling it.",
  SUCCESS: "Aurora finished this route. The swap continues on its next check.",
  INCOMPLETE_DEPOSIT: "Aurora received less than the quote expects.",
  REFUNDED: "Aurora refunded the deposit to the funding wallet.",
  FAILED: "Aurora failed this route.",
  filled: "The order filled.",
  pending: "The order is waiting for a resolver.",
};

const minutes = (ms: number) => {
  const left = Math.round((ms - Date.now()) / 60_000);
  return left >= 0 ? `in ${left} min` : `${-left} min ago`;
};
const time = (ms?: number) => (ms ? `${new Date(ms).toLocaleTimeString()} (${minutes(ms)})` : "—");
const usdc = (atoms?: string) =>
  atoms && /^\d+$/.test(atoms) ? `${formatSwapAmount(BigInt(atoms))} USDC` : "—";

function Row({ label, value, selectable }: { label: string; value: string; selectable?: boolean }) {
  return (
    <View className="gap-0.5">
      <Typography variant="micro">{label}</Typography>
      <Typography variant="caption" selectable={selectable}>
        {value}
      </Typography>
    </View>
  );
}

export function SwapDebugPanel() {
  const [debug, setDebug] = useState<Debug | null>(null);
  const [live, setLive] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError("");
    setLive("");
    try {
      const signer = swapSigner();
      if (!signer.getSwapDebug) throw new Error("Swap diagnostics need an updated native build.");
      const next = JSON.parse(await signer.getSwapDebug(swapGateway)) as Debug;
      setDebug(next);
      const route = next.route;
      // Ask the provider directly; the swap's own check runs only while its screen is open.
      if (route?.provider === "aurora" && route.depositAddress) {
        const response = await fetch(`${swapGateway}/v1/swap/aurora/status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            depositAddress: route.depositAddress,
            ...(route.depositMemo ? { depositMemo: route.depositMemo } : {}),
          }),
        });
        const body = (await response.json()) as { status?: unknown; message?: unknown };
        setLive(
          typeof body.status === "string"
            ? body.status
            : `HTTP ${response.status}${typeof body.message === "string" ? ` · ${body.message}` : ""}`,
        );
      } else if (route?.provider === "1inch" && route.orderHash) {
        const response = await fetch(`${swapGateway}/v1/swap/fusion/status`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orderHash: route.orderHash }),
        });
        const body = (await response.json()) as { status?: unknown };
        setLive(typeof body.status === "string" ? body.status : `HTTP ${response.status}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Diagnostics unavailable.");
    } finally {
      setBusy(false);
    }
  }, []);

  const route = debug?.route;
  return (
    <Surface>
      <View className="px-4 py-2">
        <HoldingDetails label="Debug: why is this swap waiting?" accessibilityLabel="Swap debug">
          <Button
            label={busy ? "Checking…" : debug ? "Check again" : "Check provider now"}
            variant="secondary"
            disabled={busy}
            onPress={() => void load()}
          />
          {error ? <Typography variant="micro">{error}</Typography> : null}
          {debug ? (
            <View className="gap-3 pb-2">
              <Row label="Engine step" value={debug.step || "—"} />
              {live ? (
                <Row
                  label="Provider says"
                  value={`${live} — ${meaning[live] ?? "Unknown status."}`}
                />
              ) : null}
              {route ? (
                <>
                  <Row
                    label="Waiting on"
                    value={`${route.kind ?? "route"} · ${route.provider ?? "?"} · ${route.chain ?? "?"}`}
                  />
                  {route.depositAddress ? (
                    <Row label="Deposit address" value={route.depositAddress} selectable />
                  ) : null}
                  {route.amountIn ? <Row label="Amount in" value={usdc(route.amountIn)} /> : null}
                  {route.deadlineMs ? (
                    <Row label="Quote deadline (refund after)" value={time(route.deadlineMs)} />
                  ) : null}
                  {route.orderHash ? (
                    <Row label="Order hash" value={route.orderHash} selectable />
                  ) : null}
                  {route.expirationMs ? (
                    <Row label="Order expires" value={time(route.expirationMs)} />
                  ) : null}
                  {route.chain === "monad" && route.depositAddress ? (
                    <Button
                      label="Open deposit in Monad explorer"
                      variant="quiet"
                      onPress={() =>
                        void Linking.openURL(
                          `https://monadexplorer.com/address/${route.depositAddress}`,
                        )
                      }
                    />
                  ) : null}
                </>
              ) : (
                <Typography variant="micro">
                  This step does not wait on a provider route.
                </Typography>
              )}
              <Row label="Signing authorization until" value={time(debug.authorizationUntilMs)} />
              <Row label="Next check" value={time(debug.waitUntilMs)} />
              <Row
                label="Retries"
                value={`${debug.failures ?? 0} transient failures · ${debug.resubmits ?? 0} resubmits`}
              />
              <Typography variant="micro">
                The swap only advances while its screen is open. If the provider already says
                SUCCESS, press Resume.
              </Typography>
            </View>
          ) : null}
        </HoldingDetails>
      </View>
    </Surface>
  );
}
