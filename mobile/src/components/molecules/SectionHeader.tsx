import type { ReactNode } from "react";
import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";

/** Section title on the left, optional meta text or action on the right. */
export function SectionHeader({
  title,
  meta,
  action,
}: {
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <View className="min-h-8 flex-row flex-wrap items-center justify-between gap-3">
      <Typography variant="cardTitle">{title}</Typography>
      {meta !== undefined && <Typography variant="micro">{meta}</Typography>}
      {action}
    </View>
  );
}
