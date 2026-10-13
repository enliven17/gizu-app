import { StatGrid, type Stat } from "@/components/molecules/StatGrid";
import { demoModeEnabled } from "@/config/demo";
import type { OwnedPortfolioAsset, OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";
import { holdingAmount } from "@/features/swap/SwapHoldingsSection";
import { demoVaultMetadata } from "@/services/demo/opportunities";

/** Holding figures revealed by expanding the card, using only its current public snapshot. */
export function HoldingDetails({
  asset,
  position,
}: {
  asset: OwnedPortfolioAsset | OwnedPortfolioPosition;
  position: boolean;
}) {
  const vault = position && demoModeEnabled() ? demoVaultMetadata(asset.assetId) : undefined;
  const network =
    { 1: "Ethereum", 143: "Monad", 4663: "Robinhood" }[asset.chainId] ?? `Chain ${asset.chainId}`;
  const stats: Stat[] = [];
  if (vault?.totalApr !== null && vault?.totalApr !== undefined) {
    stats.push({ label: "Net APY", value: `${vault.totalApr}%`, accent: true });
    stats.push({ label: "Protocol", value: vault.protocol.name });
  } else if (
    asset.complete &&
    asset.balanceAtoms !== null &&
    asset.decimals !== null &&
    asset.valueUsdcAtoms !== null &&
    BigInt(asset.balanceAtoms) > 0n &&
    !position
  ) {
    const valuePerToken =
      (BigInt(asset.valueUsdcAtoms) * 10n ** BigInt(asset.decimals)) / BigInt(asset.balanceAtoms);
    stats.push({
      label: "Value per token",
      value: `${holdingAmount(valuePerToken.toString(), 6)} USDC`,
    });
  }
  stats.push({ label: "Network", value: network });
  return <StatGrid stats={stats} />;
}
