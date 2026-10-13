import type { ReactNode } from "react";
import { View } from "react-native";
import { ArrowDownUp, ChevronDown } from "lucide-react-native";
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

/** One side of the swap: a label (and optional balance) over the amount and its token. */
export function SwapPanel({
  label,
  aside,
  amount,
  token,
}: {
  label: string;
  aside?: ReactNode;
  amount: ReactNode;
  token: ReactNode;
}) {
  return (
    <View className="gap-2 rounded-[24px] bg-well px-5 pb-5 pt-4">
      <View className="min-h-6 flex-row items-center justify-between gap-3">
        <Typography variant="label11">{label}</Typography>
        {aside}
      </View>
      <View className="flex-row items-center gap-3">
        {amount}
        {token}
      </View>
    </View>
  );
}

/** The round button between the panels that flips buying and selling. */
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
      className="z-10 -my-5 h-11 w-11 items-center justify-center self-center rounded-2xl border-4 border-ink bg-card"
    >
      <ArrowDownUp size={18} color={colors.fg["70"]} />
    </PressableScale>
  );
}

/** "Balance 250 · MAX" in a panel's corner. */
export function BalanceAside({
  text,
  onMax,
  maxDisabled,
}: {
  text: string;
  onMax?: () => void;
  maxDisabled?: boolean;
}) {
  return (
    <View className="flex-row items-center gap-2">
      <Typography variant="micro">{text}</Typography>
      {onMax ? (
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel="Use maximum USDC amount"
          accessibilityState={{ disabled: !!maxDisabled }}
          disabled={maxDisabled}
          onPress={onMax}
          hitSlop={8}
          className={`rounded-full bg-neon/15 px-2.5 py-1 ${maxDisabled ? "opacity-40" : ""}`}
        >
          <Typography variant="label11" className="!text-neon">
            MAX
          </Typography>
        </PressableScale>
      ) : null}
    </View>
  );
}
