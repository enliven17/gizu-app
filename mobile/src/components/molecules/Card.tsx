import type { PropsWithChildren, ReactNode } from "react";
import { View } from "react-native";
import { SectionHeader } from "./SectionHeader";
import { Surface } from "./Surface";

/** Padded card with an optional title row; groups one topic so screens read as sections. */
export function Card({
  title,
  meta,
  action,
  children,
}: PropsWithChildren<{ title?: string; meta?: string; action?: ReactNode }>) {
  return (
    <Surface>
      <View className="gap-4 p-5">
        {title !== undefined && <SectionHeader title={title} meta={meta} action={action} />}
        {children}
      </View>
    </Surface>
  );
}
