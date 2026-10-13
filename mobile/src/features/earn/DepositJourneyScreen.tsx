import { Image, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { BackAction } from "@/navigation/BackAction";
import type { RootStackParamList } from "@/navigation/types";
import { earnProfiles, type EarnProfileId } from "@/domain/earn/types";
import type { DepositPhase } from "@/domain/earn/depositJourney";
import { formatUsdc } from "@/domain/wallet/amounts";
import { protocolLogo } from "@/features/opportunities/protocolLogos";
import { depositPauseCopy, useDepositJourney } from "./useDepositJourney";
import colors from "@/theme/colors.json";
const stages = [
  ["funding", "Convert USDC to private balance"],
  ["credit", "Verify confidential credit"],
  ["payouts", "Hold 10% and route 90%"],
  ["deposit", "Deposit wallet 2 into the vault"],
] as const;
const phaseCopy: Partial<Record<DepositPhase, string>> = {
  preparing: "Preparing deposit review",
  authorizing: "Approve deposit on your device",
  funding: "Converting USDC to private balance",
  settlingCredit: "Verifying confidential credit",
  payouts: "Routing separate wallet payouts",
  depositing: "Depositing into the vault",
  paused: "Deposit paused",
  invested: "Invested",
};
function shareAmount(atoms: string, decimals: number) {
  const p = atoms.padStart(decimals + 1, "0");
  if (!decimals) return p;
  const fraction = p.slice(-decimals).replace(/0+$/, "");
  return p.slice(0, -decimals) + (fraction ? "." + fraction : "");
}
export function DepositJourneyScreen({
  profileId,
  savedJourneyId,
}: {
  profileId: EarnProfileId;
  savedJourneyId?: string;
}) {
  const v = useDepositJourney(profileId, savedJourneyId),
    navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const row = v.snapshot,
    review = row?.review,
    profile = earnProfiles[profileId],
    unsigned = v.editable,
    invested = row?.phase === "invested",
    paused = row?.phase === "paused";
  const holdMinimum =
    review?.sources.reduce((sum, s) => sum + BigInt(s.hold.minimumOutputAtoms), 0n).toString() ??
    "0";
  return (
    <Screen>
      <BackAction fallback="Vaults" />
      <View className="flex-row items-center gap-3">
        <Image
          source={protocolLogo("Morpho")}
          accessibilityLabel="Morpho"
          className="h-10 w-10"
          resizeMode="contain"
        />
        <View className="flex-1 gap-1">
          <Typography variant="title">Deposit</Typography>
          <Typography variant="row">
            {profileId === "robinhood-usdg" ? "Steakhouse USDG" : "Pendle USDC"}
          </Typography>
        </View>
      </View>
      {v.loading ? (
        <Typography accessibilityLiveRegion="polite">Checking deposit availability…</Typography>
      ) : !v.available ? (
        <Typography accessibilityRole="alert">{depositPauseCopy.unsupportedCapability}</Typography>
      ) : null}
      {unsigned && (
        <Surface>
          <View className="gap-3 p-5">
            <Typography variant="row">Amount in USDC</Typography>
            <TextInput
              accessibilityLabel="USDC deposit amount"
              value={v.amount}
              onChangeText={v.setAmount}
              editable={unsigned}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.fg[45]}
              className="min-h-16 rounded-2xl bg-well px-4 py-3 font-sans text-[28px] text-text"
              maxLength={38}
            />
            <Typography variant="caption">
              {v.balanceLoading
                ? "Checking available USDC…"
                : v.balanceUnavailable || v.balance === null
                  ? "Available USDC is unavailable. Refresh your wallet before investing."
                  : `Available: ${v.balance} USDC`}
            </Typography>
            <Typography variant="caption">
              Two fresh wallets are created for this investment. The 10/90 split applies to verified
              private credit after source fees.
            </Typography>
          </View>
        </Surface>
      )}
      {review && (row?.phase === "review" || paused) && (
        <Surface>
          <View className="gap-3 p-5">
            <Typography variant="heading">
              {paused ? "Remaining deposit limits" : "Review deposit"}
            </Typography>
            <Typography>Source budget: {formatUsdc(review.sourceBudgetAtoms)} USDC</Typography>
            <Typography>At least {formatUsdc(holdMinimum)} USDG held</Typography>
            <Typography>
              At least {formatUsdc(review.deposit.minimumAssetsAtoms)} USDG invested
            </Typography>
            <Typography variant="caption">
              Vault gas cap: {formatUsdc(review.deposit.maximumFeeAtoms)} USDG
            </Typography>
            <Typography variant="caption">
              Withdrawal reserve: {formatUsdc(review.deposit.withdrawalReserveAtoms)} USDG
            </Typography>
            <Typography variant="caption">
              The reserve stays liquid in wallet 2. It is not an already-paid fee.
            </Typography>
            <Typography variant="caption">
              Minimum shares:{" "}
              {shareAmount(review.deposit.minimumSharesAtoms, review.deposit.shareDecimals)}
            </Typography>
            <Typography variant="caption">
              {paused
                ? "These are saved approval limits. Native review checks the remaining operations before signing."
                : "Estimates require fresh live terms. One device approval authorizes this deposit within the displayed limits for up to 15 minutes while the app stays open."}
            </Typography>
          </View>
        </Surface>
      )}
      {row?.phase === "preparing" && row.indicativeReview && (
        <Surface>
          <View className="gap-3 p-5" accessibilityLiveRegion="polite">
            <Typography variant="heading">Deposit estimate</Typography>
            <Typography>
              Estimated 10% held: {formatUsdc(row.indicativeReview.holdEstimatedAtoms)} USDG
            </Typography>
            <Typography>
              Estimated 90% before vault fees:{" "}
              {formatUsdc(row.indicativeReview.investEstimatedAtoms)} USDG
            </Typography>
            <Typography variant="caption">
              Calculating vault fees and the withdrawal reserve…
            </Typography>
            <Typography variant="caption">
              These amounts are indicative. No funds move before the final review and your device
              approval.
            </Typography>
          </View>
        </Surface>
      )}
      {row && !unsigned && (
        <Surface>
          <View className="gap-3 p-5">
            <Typography variant="heading" accessibilityLiveRegion="polite">
              {v.authorizing
                ? "Approve deposit on your device"
                : (phaseCopy[row.phase] ?? "Deposit progress")}
            </Typography>
            {stages.map(([stage, label]) => (
              <Typography key={stage} variant="caption">
                {row.completedSteps.includes(stage) ? "✓" : "○"} {label}
              </Typography>
            ))}
            {invested && (
              <>
                <Typography>{formatUsdc(row.holdReceivedAtoms)} USDG held</Typography>
                <Typography>{formatUsdc(row.depositedAtoms)} USDG invested</Typography>
                <Typography variant="caption">
                  Your investment remains in the vault until you choose to withdraw.
                </Typography>
              </>
            )}
          </View>
        </Surface>
      )}
      {paused && (
        <Typography accessibilityRole="alert">
          {depositPauseCopy[row.pauseReason ?? "recoveryRequired"]}
        </Typography>
      )}
      {v.message !== "" && <Typography accessibilityRole="alert">{v.message}</Typography>}
      {row?.phase === "review" ? (
        <Button
          label="Confirm deposit"
          disabled={!v.canConfirm}
          loading={v.busy}
          onPress={() => void v.confirm()}
        />
      ) : unsigned ? (
        <Button
          label="Review deposit"
          disabled={!v.canReview}
          loading={v.busy}
          onPress={() => void v.review()}
        />
      ) : invested ? (
        <Button
          label="View investment"
          onPress={() => navigation.navigate("EarnInvestment", { intentId: row.intentId })}
        />
      ) : paused &&
        ![
          "recoveryRequired",
          "unsupportedCapability",
          "previewUnavailable",
          "quoteUnavailable",
        ].includes(row.pauseReason ?? "") ? (
        <Button
          label="Review remaining steps"
          disabled={v.busy}
          loading={v.busy}
          onPress={() => void v.resume()}
        />
      ) : null}
      {row?.phase === "review" && !v.canConfirm && !v.busy && (
        <>
          <Typography accessibilityRole="alert">
            The review expired or the amount changed. Refresh the estimates before confirming.
          </Typography>
          <Button
            label="Refresh deposit review"
            variant="secondary"
            onPress={() => void v.review()}
          />
        </>
      )}
      {row && !unsigned && !invested && (
        <Button
          label="Check progress"
          variant="secondary"
          disabled={v.busy}
          onPress={() => void v.refresh()}
        />
      )}
      {row && !invested && !unsigned && (
        <Button label="Stop remaining approval" variant="quiet" onPress={v.cancel} />
      )}
      {row && (
        <Button
          label={v.details ? "Hide details" : "Details"}
          variant="quiet"
          onPress={() => v.setDetails(!v.details)}
        />
      )}
      {v.details && row && (
        <Surface>
          <View className="gap-2 p-5">
            <Typography variant="row">Wallet 1 · hold</Typography>
            <Typography selectable variant="caption">
              {row.destinations[0].address}
            </Typography>
            <Typography variant="row">Wallet 2 · invest</Typography>
            <Typography selectable variant="caption">
              {row.destinations[1].address}
            </Typography>
            <Typography variant="caption">Vault contract</Typography>
            <Typography selectable variant="caption">
              {profile.vault}
            </Typography>
            {review?.sources.map((source) => (
              <View key={source.operationId} className="gap-1">
                <Typography selectable variant="caption">
                  {source.address}
                </Typography>
                <Typography variant="caption">
                  Budget {formatUsdc(source.budgetAtoms)} USDC · gas cap{" "}
                  {formatUsdc(source.maximumFeeAtoms)} USDC · retained{" "}
                  {formatUsdc(source.retainedAtoms)} USDC
                </Typography>
              </View>
            ))}
            {row.depositTransactionHash && (
              <Typography selectable variant="caption">
                {row.depositTransactionHash}
              </Typography>
            )}
            <Typography variant="caption">
              Public chains and routing providers can observe amounts and timing. Each destination
              uses its own transaction. Withdrawal and return need a separate review.
            </Typography>
          </View>
        </Surface>
      )}
    </Screen>
  );
}
