import type { Opportunity } from "@/domain/opportunities";
import { earnProfiles, type EarnProfileId } from "./types";

/** Catalog metadata cannot grant new native execution authority. */
export function catalogEarnProfile(
  vault: Opportunity & { explorerAddress?: string },
): EarnProfileId | null {
  const address = vault.vaultAddress ?? vault.explorerAddress;
  if (!address) return null;
  return (
    (Object.keys(earnProfiles) as EarnProfileId[]).find((id) => {
      const profile = earnProfiles[id];
      return (
        vault.chainId === profile.chainId &&
        address.toLowerCase() === profile.vault.toLowerCase() &&
        (!vault.asset ||
          (vault.asset.address.toLowerCase() === profile.token.toLowerCase() &&
            vault.asset.decimals === profile.decimals &&
            vault.asset.symbol === profile.symbol))
      );
    }) ?? null
  );
}
