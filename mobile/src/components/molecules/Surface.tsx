import type { ComponentProps, PropsWithChildren } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
// Raised card: one luminance step above the page, hairline edge, no backdrop blur on native.
export function Surface({
  children,
  className = "",
  layout,
}: PropsWithChildren<{
  className?: string;
  layout?: ComponentProps<typeof Animated.View>["layout"];
}>) {
  const surfaceClass = `overflow-hidden rounded-card border border-cardEdge bg-card ${className}`;
  if (layout)
    return (
      <Animated.View layout={layout} className={surfaceClass}>
        {children}
      </Animated.View>
    );
  return <View className={surfaceClass}>{children}</View>;
}
