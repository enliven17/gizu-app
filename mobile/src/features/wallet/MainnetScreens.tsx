import type { OwnedPortfolioAsset, OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";
import { useCallback, useState } from "react";
import { Platform, Pressable, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import colors from "@/theme/colors.json";
import { useFocusEffect } from "@react-navigation/native";
import type {
  NativeStackScreenProps,
  NativeStackNavigationProp,
} from "@react-navigation/native-stack";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { BackAction } from "@/navigation/BackAction";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { Notice } from "@/components/molecules/Notice";
import { AccountAddress } from "@/features/account/AccountAddress";
import { clipboardService } from "@/services/clipboard";
import { PortfolioActions } from "@/features/investments/components/PortfolioActions";
import { VaultPreview } from "@/features/investments/components/VaultPreview";
import { SwapHoldingsSection, holdingAmount } from "@/features/swap/SwapHoldingsSection";
import { useMainnetWallet } from "./MainnetWalletProvider";

function usePortfolio() {
  const wallet = useMainnetWallet();
  const { refresh } = wallet;
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );
  return wallet;
}
function BalanceStatus({ showRefresh = true }: { showRefresh?: boolean }) {
  const wallet = useMainnetWallet();
  return (
    <>
      {wallet.loading || wallet.snapshot?.balanceComplete === false ? (
        <Typography variant="micro" accessibilityLiveRegion="polite">
          Checking Monad mainnet balances…
        </Typography>
      ) : null}
      {wallet.snapshot?.stale && !wallet.error && (
        <Typography variant="micro">Previously cached balances are being checked.</Typography>
      )}
      {wallet.error ? (
        <Notice
          error
          message={
            wallet.error + (wallet.snapshot ? " Previously loaded balances may be stale." : "")
          }
        />
      ) : null}
      {showRefresh && (
        <Button
          label="Refresh mainnet balances"
          variant="quiet"
          disabled={wallet.loading}
          onPress={() => void wallet.refresh()}
        />
      )}
    </>
  );
}
function WalletDetails() {
  const [expanded, setExpanded] = useState(false);
  return (
    <View className="gap-3">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Wallet details"
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        className="min-h-11 flex-row items-center justify-between gap-3"
      >
        <Typography variant="caption">Wallet details</Typography>
        {expanded ? (
          <ChevronUp size={18} color={colors.text} />
        ) : (
          <ChevronDown size={18} color={colors.text} />
        )}
      </Pressable>
      {expanded && <ReceivingAccounts />}
    </View>
  );
}

function ReceivingAccounts() {
  const { snapshot } = useMainnetWallet();
  const [message, setMessage] = useState("");
  return (
    <View className="gap-3">
      <Typography variant="section">USDC accounts</Typography>
      <Typography variant="micro">
        All these wallets count toward your USDC balance. Funds stay in their respective wallets.
      </Typography>
      {snapshot?.accounts.map((account) => (
        <Surface key={account.address}>
          <View className="gap-2 p-5">
            <Typography variant="rowTitle">
              {account.role === "funding"
                ? "Swap funding"
                : `Receiving account ${account.accountIndex}`}
            </Typography>
            <Typography>
              {snapshot.balanceComplete === false
                ? "Checking balance…"
                : `${holdingAmount(account.balanceAtoms, 6)} USDC`}
            </Typography>
            <Typography variant="micro" selectable>
              {account.address}
            </Typography>
            <Button
              variant="quiet"
              label={`Copy ${account.role === "funding" ? "funding" : `receiving ${account.accountIndex}`} address`}
              onPress={() => {
                void clipboardService.copy(account.address).then(
                  () => setMessage("Address copied."),
                  () => setMessage("Could not copy address."),
                );
              }}
            />
          </View>
        </Surface>
      ))}
      {message ? (
        <Typography accessibilityLiveRegion="polite" variant="micro">
          {message}
        </Typography>
      ) : null}
    </View>
  );
}

function OwnedBalanceRow({
  asset,
  position = false,
}: {
  asset: OwnedPortfolioAsset | OwnedPortfolioPosition;
  position?: boolean;
}) {
  const estimated = position && "conversionEstimated" in asset && asset.conversionEstimated;
  const amount =
    position && "underlyingAtoms" in asset ? asset.underlyingAtoms : asset.balanceAtoms;
  const observedAmount = position
    ? "observedUnderlyingAtoms" in asset
      ? asset.observedUnderlyingAtoms
      : null
    : asset.observedAtoms;
  return (
    <Surface>
      <View className="gap-2 p-5">
        <Typography variant="rowTitle">
          {position ? "Vault position" : "Token balance"} · {asset.symbol}
        </Typography>
        <Typography variant="micro">Chain {asset.chainId}</Typography>
        <Typography>
          {asset.complete && amount !== null && asset.decimals !== null
            ? `${estimated ? "Estimated underlying: " : ""}${holdingAmount(amount, asset.decimals)} ${asset.symbol}`
            : `Checking ${asset.symbol} balance…`}
        </Typography>
        {!asset.complete &&
          typeof observedAmount === "string" &&
          observedAmount !== "0" &&
          asset.decimals !== null && (
            <Typography variant="micro">
              Previously observed: {holdingAmount(observedAmount, asset.decimals)} {asset.symbol}
            </Typography>
          )}
        {asset.valueUsdcAtoms !== null ? (
          <Typography>Value: {holdingAmount(asset.valueUsdcAtoms, 6)} USDC</Typography>
        ) : (
          <Typography variant="micro">
            {asset.valuationUnavailable ? "USDC value unavailable." : "Checking USDC value…"}
          </Typography>
        )}
        {asset.stale && <Typography variant="micro">Cached amount awaiting refresh.</Typography>}
      </View>
    </Surface>
  );
}
function OwnedBalances() {
  const { snapshot } = useMainnetWallet();
  if (!snapshot?.ownedAssets && !snapshot?.positions) return null;
  return (
    <View className="gap-3">
      <Typography variant="section">Tokens and vault positions</Typography>
      {snapshot.ownedBalanceComplete === false && (
        <Typography variant="micro">Checking owned token balances and positions…</Typography>
      )}
      {snapshot.valuationComplete === false && (
        <Typography variant="micro">
          Some assets have no verified USDC value. Token amounts are shown separately.
        </Typography>
      )}
      {snapshot.ownedAssets?.map((asset) => (
        <OwnedBalanceRow key={asset.assetId} asset={asset} />
      ))}
      {snapshot.positions?.map((asset) => (
        <OwnedBalanceRow key={asset.assetId} asset={asset} position />
      ))}
    </View>
  );
}

export function MainnetPortfolioScreen({
  navigation,
}: BottomTabScreenProps<MainTabParamList, "Home">) {
  const wallet = usePortfolio();
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Screen refreshing={wallet.loading} onRefresh={() => void wallet.refresh()}>
      <View className="flex-row items-center gap-3">
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <GizuLogo width={28} height={38} />
        </View>
        <Typography variant="pageTitle" accessibilityRole="header" className="flex-1">
          Your portfolio
        </Typography>
      </View>
      <BalanceStatus showRefresh={false} />
      {wallet.snapshot && wallet.snapshot.balanceComplete !== false ? (
        <Surface>
          <View className="gap-3 p-5">
            <Typography variant="micro">USDC balance</Typography>
            <Typography
              variant="title"
              accessibilityLabel={`${holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC`}
            >
              {holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC
            </Typography>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Balance details"
              accessibilityState={{ expanded: detailsExpanded }}
              onPress={() => setDetailsExpanded((expanded) => !expanded)}
              className="min-h-11 flex-row items-center justify-between gap-3"
            >
              <Typography variant="caption">Balance details</Typography>
              {detailsExpanded ? (
                <ChevronUp size={18} color={colors.text} />
              ) : (
                <ChevronDown size={18} color={colors.text} />
              )}
            </Pressable>
            {detailsExpanded && (
              <View className="gap-3">
                <Typography>
                  Swap funding: {holdingAmount(wallet.snapshot.fundingAtoms, 6)} USDC
                </Typography>
                <Typography>
                  Receiving wallets: {holdingAmount(wallet.snapshot.returnAtoms, 6)} USDC
                </Typography>
                <Typography variant="micro">
                  Last checked {new Date(wallet.snapshot.checkedAt).toLocaleTimeString()}
                </Typography>
              </View>
            )}
          </View>
        </Surface>
      ) : null}
      {/* Home Earn shortcut is temporarily hidden; the Earn flow remains available. */}
      <OwnedBalances />
      <PortfolioActions
        onDeposit={() => root.navigate("Transaction", { kind: "deposit" })}
        onWithdraw={() => root.navigate("Transaction", { kind: "withdraw" })}
        onActivity={() => root.navigate("Activity")}
      />
      <WalletDetails />
      {Platform.OS === "android" ? (
        <SwapHoldingsSection />
      ) : (
        <Typography variant="micro">Token holdings are not yet available on iOS.</Typography>
      )}
      <VaultPreview
        onSeeAll={() => navigation.navigate("Vaults")}
        onOpen={(id) => root.navigate("OpportunityDetail", { id })}
      />
    </Screen>
  );
}

export function MainnetTransaction({
  route,
}: NativeStackScreenProps<RootStackParamList, "Transaction">) {
  const wallet = usePortfolio();
  const deposit = route.params.kind === "deposit";
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="title">{deposit ? "Receive" : "Send"}</Typography>
      {deposit ? (
        <>
          <AccountAddress />
          <Typography variant="micro">Refresh your balance after funds arrive.</Typography>
        </>
      ) : (
        <Notice message="Sending USDC directly is not available yet. Your funds remain in your wallets." />
      )}
      <BalanceStatus />
      {wallet.snapshot && wallet.snapshot.balanceComplete !== false ? (
        <Typography>Total: {holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC</Typography>
      ) : null}
      <WalletDetails />
    </Screen>
  );
}

export function MainnetActivity() {
  const wallet = usePortfolio();
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="heading">Activity</Typography>
      <Typography variant="caption">
        Mainnet swaps recorded on this device. Incoming deposits and older overwritten operations
        are not a complete transaction history.
      </Typography>
      <Typography variant="micro">Open Swap to resume a running or paused operation.</Typography>
      <BalanceStatus />
      {wallet.snapshot?.history.length === 0 ? (
        <Typography>No completed or cancelled swaps recorded yet.</Typography>
      ) : null}
      {wallet.snapshot?.history.map((item) => (
        <Surface key={item.operationId}>
          <View className="gap-2 p-5">
            <Typography variant="rowTitle">
              {item.direction === "sell" ? "Sell" : "Buy"} {item.symbol}
            </Typography>
            <Typography>{item.phase === "COMPLETE" ? "Completed" : "Cancelled"}</Typography>
            {item.direction === "sell" && item.phase === "COMPLETE" ? (
              <Typography>Returned {holdingAmount(item.receivedAtoms, 6)} USDC on Monad</Typography>
            ) : null}
            <Typography variant="micro">{new Date(item.recordedAt).toLocaleString()}</Typography>
          </View>
        </Surface>
      ))}
    </Screen>
  );
}
