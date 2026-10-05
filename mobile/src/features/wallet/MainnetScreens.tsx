import type { OwnedPortfolioAsset, OwnedPortfolioPosition } from "@/domain/wallet/storedSigner";
import { useCallback, useState } from "react";
import { Platform, View } from "react-native";
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
function ReceivingAccounts() {
  const { snapshot } = useMainnetWallet();
  const [message, setMessage] = useState("");
  return (
    <View className="gap-3">
      <Typography variant="section">USDC accounts</Typography>
      <Typography variant="micro">
        Returned proceeds stay in separate receiving wallets. They are included in your total, but
        are not automatically moved into the swap funding account.
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
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Screen refreshing={wallet.loading} onRefresh={() => void wallet.refresh()}>
      <Typography variant="pageTitle" accessibilityRole="header">
        Your portfolio
      </Typography>
      <BalanceStatus showRefresh={false} />
      {wallet.snapshot && wallet.snapshot.balanceComplete !== false ? (
        <Surface>
          <View className="gap-3 p-5">
            <Typography variant="micro">
              Total USDC across funding and receiving accounts
            </Typography>
            <Typography
              variant="title"
              accessibilityLabel={`${holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC`}
            >
              {holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC
            </Typography>
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
        </Surface>
      ) : null}
      <Button label="Confidential earn" variant="secondary" onPress={() => root.navigate("Earn")} />
      <OwnedBalances />
      <PortfolioActions
        onDeposit={() => root.navigate("Transaction", { kind: "deposit" })}
        onWithdraw={() => root.navigate("Transaction", { kind: "withdraw" })}
        onActivity={() => root.navigate("Activity")}
      />
      <ReceivingAccounts />
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
      <Typography variant="title">{deposit ? "Deposit" : "Withdraw"}</Typography>
      <Typography variant="caption">Monad mainnet · USDC</Typography>
      {deposit ? (
        <>
          <Typography>Send USDC on Monad mainnet to your swap funding address.</Typography>
          <AccountAddress />
          <Typography variant="micro">
            Incoming deposits are reflected after refreshing balances. This does not deposit into a
            vault.
          </Typography>
        </>
      ) : (
        <Notice message="Direct mainnet withdrawals are not available yet. Returned USDC remains in your receiving wallets. Selling tokens through Swap is a separate approved operation." />
      )}
      <BalanceStatus />
      {wallet.snapshot && wallet.snapshot.balanceComplete !== false ? (
        <Typography>Total: {holdingAmount(wallet.snapshot.totalAtoms, 6)} USDC</Typography>
      ) : null}
      <ReceivingAccounts />
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
