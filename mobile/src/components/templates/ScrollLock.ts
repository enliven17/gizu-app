import { createContext, useContext } from "react";

/**
 * Lets a touch-driven child (chart scrub) pause the enclosing Screen's scrolling.
 * Android's ScrollView otherwise steals the gesture after a few pixels of vertical
 * movement, which terminates the scrub and snaps it back.
 */
export const ScrollLockContext = createContext<(locked: boolean) => void>(() => {});

export function useScrollLock() {
  return useContext(ScrollLockContext);
}
