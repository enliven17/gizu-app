import { demoModeEnabled } from "@/config/demo";
import { demoVaultMetadata } from "./opportunities";

/** Display fixtures for a month of holding value; never used to quote or sign. */
export function demoHoldingPerformance(
  assetId: string,
  valueUsdcAtoms: string | null,
  position: boolean,
) {
  if (!demoModeEnabled() || valueUsdcAtoms === null || !/^(0|[1-9]\d*)$/.test(valueUsdcAtoms))
    return null;
  const current = Number(valueUsdcAtoms) / 1e6;
  if (!Number.isFinite(current) || current <= 0) return null;
  const seed = [...assetId].reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
  const vault = position ? demoVaultMetadata(assetId) : undefined;
  if (position && !vault) return null;
  const monthlyChange = vault
    ? Math.pow(1 + (vault.totalApr ?? 0) / 100, 30 / 365) - 1
    : [0.068, -0.026, 0.041, 0.097, 0.018][seed % 5]!;
  const start = current / (1 + monthlyChange);
  const series = Array.from({ length: 30 }, (_, index) => {
    if (index === 0) return start;
    if (index === 29) return current;
    const progress = index / 29;
    const wave = Math.sin(progress * Math.PI) * Math.sin(progress * Math.PI * 4 + (seed % 7));
    return start + (current - start) * progress + current * wave * (position ? 0.00015 : 0.006);
  });
  return { series, percent: monthlyChange * 100 };
}
