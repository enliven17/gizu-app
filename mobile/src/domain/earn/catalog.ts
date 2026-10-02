import type { OpportunityDetail } from "@/domain/opportunities";
import { earnProfiles, type EarnProfileId } from "./types";

/** Catalog metadata cannot grant new native execution authority. */
export function catalogEarnProfile(vault: OpportunityDetail): EarnProfileId | null {
  const address = vault.vaultAddress ?? vault.explorerAddress;
  return (
    (Object.keys(earnProfiles) as EarnProfileId[]).find((id) => {
      const profile = earnProfiles[id];
      return (
        vault.chainId === profile.chainId && address.toLowerCase() === profile.vault.toLowerCase()
      );
    }) ?? null
  );
}
