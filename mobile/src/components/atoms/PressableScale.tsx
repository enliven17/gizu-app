import type { ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";

export type PressableScaleProps = Omit<PressableProps, "style" | "children"> & {
  children?: ReactNode;
  className?: string;
  style?: StyleProp<ViewStyle>;
  /** Scale while pressed; frontend buttons settle around 0.97, rows at 0.99. */
  pressedScale?: 0.97 | 0.99;
};

// Static class strings so Tailwind can generate them.
const pressedClasses = {
  0.97: "active:scale-[0.97] active:opacity-85",
  0.99: "active:scale-[0.99] active:opacity-85",
} as const;

/**
 * Pressable with frontend-style press feedback.
 * Plain Pressable + NativeWind `active:` variants: a Reanimated animated Pressable with
 * cssInterop dropped className styles (backgrounds, sizing) on Android devices.
 */
export function PressableScale({
  className = "",
  pressedScale = 0.97,
  disabled,
  ...props
}: PressableScaleProps) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      // Keep pseudo-class variants constant: adding `active:` after the first render makes
      // css-interop print an upgrade warning that deep-stringifies props and crashes on
      // React Navigation's context placeholder. Disabled Pressables never enter `active`.
      className={`${className} ${pressedClasses[pressedScale]}`}
    />
  );
}
