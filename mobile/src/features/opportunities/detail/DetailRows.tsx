import type { PropsWithChildren } from "react";
import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { FadeIn } from "@/components/molecules/FadeIn";

const tabular = { fontVariant: ["tabular-nums" as const] };

/** Frontend detail section: 20px heading over a glass panel. */
export function DetailSection({
  title,
  delay,
  children,
}: PropsWithChildren<{ title: string; delay: number }>) {
  return (
    <FadeIn delay={delay} className="mt-3 gap-3">
      <Typography variant="section">{title}</Typography>
      {children}
    </FadeIn>
  );
}

/** Label on the left, long wrapping value on the right (frontend Details rows). */
export function KeyValueRow({ label, value }: { label: string; value: string }) {
  return (
    <View
      className="flex-row items-start justify-between gap-4 border-b border-divider px-5 py-4"
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Typography variant="caption" className="shrink-0 !text-[13px] !text-fg-45">
        {label}
      </Typography>
      <Typography
        variant="rowValue"
        className="min-w-0 flex-1 text-right !text-[12px] !text-fg-85"
        style={tabular}
      >
        {value}
      </Typography>
    </View>
  );
}
