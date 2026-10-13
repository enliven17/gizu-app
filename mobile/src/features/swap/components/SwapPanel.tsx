import type { ReactNode } from "react";
import { View } from "react-native";
import { ArrowDown, ChevronDown } from "lucide-react-native";
import { PressableScale } from "@/components/atoms/PressableScale";
import { Typography } from "@/components/atoms/Typography";
import colors from "@/theme/colors.json";

/** The large amount line of a swap panel; dimmed while it is only a placeholder. */
export function SwapAmount({ value, muted = false }: { value: string; muted?: boolean }) {
  return (
    <Typography
      variant="rowTitle"
      numberOfLines={1}
      adjustsFontSizeToFit
      className={`flex-1 !text-[40px] !leading-[48px] ${muted ? "!text-fg-20" : ""}`}
      style={{ fontVariant: ["tabular-nums"] }}
    >
      {value}
    </Typography>
  );
}

/** A token pill; with `onPress` it opens a chooser and shows a chevron. */
export function TokenPill({
  symbol,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  symbol: string | null;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <View
      className={`h-11 flex-row items-center gap-1.5 rounded-full px-4 ${symbol ? "border border-borderSoft bg-card" : "bg-neon"}`}
    >
      <Typography variant="rowTitle" className={`!text-[17px] ${symbol ? "" : "!text-ctaText"}`}>
        {symbol ?? "Select"}
      </Typography>
      {onPress ? <ChevronDown size={16} color={symbol ? colors.fg["55"] : colors.ctaText} /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
    >
      {body}
    </PressableScale>
  );
}

/** One side of the swap as its own card: label and balance, the amount and its token, an optional footer. */
export function SwapPanel({
  label,
  aside,
  amount,
  token,
  footer,
}: {
  label: string;
  aside?: ReactNode;
  amount: ReactNode;
  token: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <View className="gap-4 rounded-[28px] border border-cardEdge bg-card px-6 py-6">
      <View className="min-h-5 flex-row items-center justify-between gap-3">
        <Typography variant="label11" className="tracking-[2px]">
          {label}
        </Typography>
        {aside}
      </View>
      <View className="flex-row items-center gap-3">
        {amount}
        {token}
      </View>
      {footer}
    </View>
  );
}

/** 25% / 50% / 75% / Max of a USDC balance, given in atoms. */
export function PercentChips({
  balanceAtoms,
  disabled,
  onPick,
}: {
  balanceAtoms: bigint | null;
  disabled?: boolean;
  onPick: (atoms: bigint) => void;
}) {
  const off = disabled || balanceAtoms === null;
  return (
    <View className="flex-row gap-2">
      {[25, 50, 75, 100].map((percent) => (
        <PressableScale
          key={percent}
          accessibilityRole="button"
          accessibilityLabel={
            percent === 100 ? "Use maximum USDC amount" : `Use ${percent}% of USDC`
          }
          accessibilityState={{ disabled: off }}
          disabled={off}
          onPress={() => {
            if (balanceAtoms !== null) onPick((balanceAtoms * BigInt(percent)) / 100n);
          }}
          className={`flex-1 items-center rounded-xl bg-well py-2.5 ${off ? "opacity-40" : ""}`}
        >
          <Typography variant="caption" className="!text-[12px] !text-fg-55">
            {percent === 100 ? "Max" : `${percent}%`}
          </Typography>
        </PressableScale>
      ))}
    </View>
  );
}

/** The square button overlapping both cards that flips buying and selling. */
export function FlipButton({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      className="z-10 -my-6 h-14 w-14 items-center justify-center self-center rounded-2xl border border-cardEdge bg-ink"
    >
      <ArrowDown size={18} color={colors.neon.DEFAULT} />
    </PressableScale>
  );
}

/** "Balance 250" in a panel's corner. */
export function BalanceAside({ text }: { text: string }) {
  return <Typography variant="micro">{text}</Typography>;
}
