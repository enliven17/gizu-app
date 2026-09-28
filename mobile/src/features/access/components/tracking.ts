import { Platform } from "react-native";

/**
 * Negative letter spacing for display text, iOS only. Android measures text with
 * letterSpacing slightly narrower than it draws, so a line can wrap inside a box
 * sized for one line and the wrapped word is clipped (seen on device as a missing word).
 */
export function tracking(value: number): number {
  return Platform.OS === "ios" ? value : 0;
}
