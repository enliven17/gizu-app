import type { PropsWithChildren } from "react";
import { View } from "react-native";
// Raised card: one luminance step above the page, hairline edge, no backdrop blur on native.
export function Surface({ children }: PropsWithChildren) {
  return (
    <View className="overflow-hidden rounded-card border border-cardEdge bg-card">{children}</View>
  );
}
