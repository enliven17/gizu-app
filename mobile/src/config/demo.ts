/** Demo-day data is selected explicitly; unset the flag to use live services. */
export function demoModeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_SWAP_DEMO === "1";
}
