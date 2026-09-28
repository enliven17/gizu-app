import type { PropsWithChildren } from "react";
import { View } from "react-native";
// Frontend `.glass` panel; backdrop blur is intentionally omitted on native.
export function Surface({ children }: PropsWithChildren) {
  return (
    <View className="overflow-hidden rounded-card border border-glassBorder bg-glass">
      {children}
    </View>
  );
}
