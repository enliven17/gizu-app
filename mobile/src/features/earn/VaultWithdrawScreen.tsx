import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { demoModeEnabled } from "@/config/demo";
import { catalogEarnProfile } from "@/domain/earn/catalog";
import type { OpportunityDetail } from "@/domain/opportunities";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { Screen } from "@/components/templates/Screen";
import { BackAction } from "@/navigation/BackAction";
import type { RootStackParamList } from "@/navigation/types";
import { useOpportunityDetail } from "@/features/opportunities/useOpportunityDetail";
import { useFundingWallet } from "@/features/wallet/WalletProvider";
import { useEarn } from "./EarnProvider";
import { DemoVaultWithdrawScreen } from "./demo/DemoVaultWithdrawScreen";
import { isDemoVaultId } from "@/services/demo/opportunities";

type Props = NativeStackScreenProps<RootStackParamList, "VaultWithdraw">;

export function VaultWithdrawScreen({ route, navigation }: Props) {
  const { load, retry } = useOpportunityDetail(route.params.opportunityId);
  if (load.kind !== "ready")
    return (
      <Screen>
        <BackAction fallback="Vaults" />
        <Typography variant="title">Withdraw</Typography>
        {load.kind === "loading" ? (
          <Typography>Checking your investment…</Typography>
        ) : (
          <>
            <Typography accessibilityRole="alert">Couldn’t load this vault.</Typography>
            <Button label="Retry" onPress={retry} />
          </>
        )}
      </Screen>
    );
  if (demoModeEnabled())
    return load.opportunity.type === "DEMO_VAULT" && isDemoVaultId(load.opportunity.id) ? (
      <DemoVaultWithdrawScreen key={load.opportunity.id} vault={load.opportunity} />
    ) : (
      <Screen>
        <BackAction fallback="Vaults" />
        <Typography variant="title">Withdraw</Typography>
        <Typography>No demo investment is available for this vault.</Typography>
      </Screen>
    );
  return <ExistingVaultInvestments vault={load.opportunity} navigation={navigation} />;
}

/** Real withdrawals open an owned, existing cycle. They never prepare a new wallet pair. */
function ExistingVaultInvestments({
  vault,
  navigation,
}: {
  vault: OpportunityDetail;
  navigation: Props["navigation"];
}) {
  const earn = useEarn();
  const wallet = useFundingWallet();
  const profileId = catalogEarnProfile(vault);
  const selected = earn.state && "intentId" in earn.state ? earn.state : null;
  const saved =
    selected && !earn.cycles.some((cycle) => cycle.intentId === selected.intentId)
      ? [...earn.cycles, selected]
      : earn.cycles;
  const cycles = saved.filter(
    (cycle) =>
      cycle.walletId === wallet.session.walletId &&
      cycle.sourceAddress.toLowerCase() === wallet.session.address.toLowerCase() &&
      cycle.profileId === profileId,
  );
  return (
    <Screen>
      <BackAction fallback="Vaults" />
      <Typography variant="title">Withdraw</Typography>
      <Typography variant="heading">{vault.name}</Typography>
      {earn.loading ? (
        <Typography>Checking your investments…</Typography>
      ) : earn.message && !earn.state ? (
        <Button label="Retry investments" onPress={() => void earn.refresh()} />
      ) : cycles.length ? (
        <>
          <Typography>Choose your investment.</Typography>
          {cycles.map((cycle, index) => (
            <Button
              key={cycle.intentId}
              label={cycles.length === 1 ? "Review withdrawal" : `Investment ${index + 1}`}
              disabled={earn.busy}
              onPress={() => navigation.replace("EarnInvestment", { intentId: cycle.intentId })}
            />
          ))}
        </>
      ) : (
        <Typography>No saved investments to withdraw from this vault.</Typography>
      )}
      {earn.message && <Typography accessibilityRole="alert">{earn.message}</Typography>}
    </Screen>
  );
}
