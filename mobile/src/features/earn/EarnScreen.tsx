import { useState } from "react";
import { View } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Choice } from "@/components/molecules/Choice";
import { Surface } from "@/components/molecules/Surface";
import { BackAction } from "@/navigation/BackAction";
import { useFundingWallet } from "@/features/wallet/WalletProvider";
import { earnProfiles, type EarnProfileId } from "@/domain/earn/types";
import { useEarn } from "./EarnProvider";
import { PrivateBalancePanel } from "./PrivateBalancePanel";
import { PreflightPanel } from "./PreflightPanel";
import { VaultExecutionPanel } from "./VaultExecutionPanel";
import { RobinhoodExecutionPanel } from "./RobinhoodExecutionPanel";
import { SourceFundingPanel } from "./SourceFundingPanel";

export function EarnScreen() {
  const wallet = useFundingWallet();
  const earn = useEarn();
  const [selected, setSelected] = useState<EarnProfileId>("ethereum-usdc");
  const intent = earn.state && "intentId" in earn.state ? earn.state : null;
  const recovery = earn.state?.status === "recoveryRequired";
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="title">Confidential earn</Typography>
      <Typography>Use USDC from your funded Monad mainnet accounts.</Typography>
      {earn.cycles.length > 1 &&
        earn.cycles.map((cycle) => (
          <Button
            key={cycle.intentId}
            variant="secondary"
            label={`Open ${earnProfiles[cycle.profileId].name} cycle ${cycle.cycleIndex ?? 0}`}
            disabled={earn.busy || cycle.intentId === intent?.intentId}
            onPress={() => void earn.selectCycle?.(cycle.intentId)}
          />
        ))}
      <Surface>
        <View className="gap-2 p-5">
          <Typography variant="row">Source · Monad mainnet USDC</Typography>
          <Typography selectable variant="caption">
            {wallet.session.address}
          </Typography>
          <Typography>
            {wallet.loading
              ? "Checking source balance…"
              : wallet.error
                ? "Source balance unavailable. Refresh before investing."
                : `Source balance: ${wallet.balance} USDC`}
          </Typography>
        </View>
      </Surface>
      {earn.loading ? (
        <Typography accessibilityLiveRegion="polite">Checking saved earn intent…</Typography>
      ) : intent ? (
        <>
          <Typography variant="heading">{earnProfiles[intent.profileId].name}</Typography>
          {earn.prepareNew && (
            <View className="gap-2">
              {(Object.keys(earnProfiles) as EarnProfileId[]).map((profile) => (
                <Button
                  key={profile}
                  variant="secondary"
                  label={`Start new ${earnProfiles[profile].name} cycle`}
                  disabled={earn.busy}
                  onPress={() => void earn.prepareNew?.(profile)}
                />
              ))}
            </View>
          )}
          {intent.destinations.map((destination, i) => (
            <Surface key={destination.role}>
              <View className="gap-2 p-5">
                <Typography variant="row">
                  {i === 0 ? "Wallet 1 · Hold 10%" : "Wallet 2 · Invest 90%"}
                </Typography>
                <Typography selectable variant="caption">
                  {destination.address}
                </Typography>
                <Typography variant="caption">
                  {earnProfiles[intent.profileId].symbol} · Chain {destination.chainId}
                </Typography>
              </View>
            </Surface>
          ))}
          <Typography>
            Both wallets are covered by your verified source wallet backup and the same passkey.
            Reopening this intent keeps the same pair.
          </Typography>
          <Typography>
            The split uses confirmed confidential credit after source fees. Each payout has separate
            fees; only wallet 2 invests.
          </Typography>
          {recovery && (
            <Typography accessibilityRole="alert">
              Recovered wallets require activity reconciliation before funding. A restored backup
              does not prove that a previous transfer or investment is absent.
            </Typography>
          )}
          {recovery && (
            <View className="gap-2">
              {(Object.keys(earnProfiles) as EarnProfileId[]).map((profile) => (
                <Button
                  key={profile}
                  label={`Recover ${earnProfiles[profile].name} wallets`}
                  variant="secondary"
                  loading={earn.busy}
                  onPress={() => void earn.prepare(profile)}
                />
              ))}
            </View>
          )}
          <Typography>
            Review current fees before funding, then approve each operation with your passkey. Earn
            stops invested; withdrawal and return need a separate user request.
          </Typography>
          <PrivateBalancePanel key={`private:${intent.intentId}`} intent={intent} />
          <SourceFundingPanel key={`source:${intent.intentId}`} intent={intent} />
          <PreflightPanel key={intent.intentId} intent={intent} />
          {intent.profileId === "ethereum-usdc" ? (
            <VaultExecutionPanel key={`vault:${intent.intentId}`} intent={intent} />
          ) : (
            <RobinhoodExecutionPanel
              key={`hood:${intent.intentId}`}
              intent={intent}
              service={earn.robinhood}
            />
          )}
        </>
      ) : (
        <>
          {recovery && (
            <Typography>
              Choose the original destination profile to recover its wallet pair. Activity
              reconciliation is required before funding.
            </Typography>
          )}
          <Typography variant="heading">Choose destination</Typography>
          <View className="gap-2">
            {(Object.keys(earnProfiles) as EarnProfileId[]).map((profile) => (
              <Choice
                key={profile}
                label={earnProfiles[profile].name}
                selected={selected === profile}
                onPress={() => {
                  if (!earn.busy) setSelected(profile);
                }}
              />
            ))}
          </View>
          <Typography>
            Prepare two wallets when you decide to invest. Wallet 1 holds 10%; wallet 2 invests 90%
            after fees. This does not transfer any funds.
          </Typography>
          <Typography variant="caption">
            Each earn cycle keeps its own destination pair and saved operations.
          </Typography>
          <Button
            label={
              earn.busy
                ? "Preparing wallets…"
                : recovery
                  ? "Recover earn wallets"
                  : "Prepare earn wallets"
            }
            loading={earn.busy}
            disabled={earn.loading || !earn.state}
            onPress={() => void earn.prepare(selected)}
          />
        </>
      )}
      {earn.message !== "" && <Typography accessibilityRole="alert">{earn.message}</Typography>}
      {!earn.state && !earn.loading && (
        <Button
          label="Check saved intent"
          variant="secondary"
          onPress={() => void earn.refresh()}
        />
      )}
      <Typography variant="caption">
        Public chains and providers can observe amounts and timing. Privacy is limited. Return
        quotes and resolver fills are not guaranteed. Future withdrawal needs a fresh review and
        enough gas; WETH cannot pay Ethereum gas.
      </Typography>
    </Screen>
  );
}
