import { MainnetWalletProvider } from "@/features/wallet/MainnetWalletProvider";
import { OpportunityServiceContext } from "@/features/opportunities/useOpportunities";
import { opportunityService as defaultOpportunityService } from "@/services/opportunities";
import type { OpportunityService } from "@/domain/opportunities";
import type { WalletTransferService } from "@/domain/wallet/types";
import { WalletProvider } from "@/features/wallet/WalletProvider";
import type { WalletBalanceService } from "@/services/wallet/balance";
import type { ReactNode } from "react";
import { AccountProvider, type AccountDependencies } from "@/features/account/AccountProvider";
import { NotificationProvider } from "@/features/notifications/NotificationProvider";
import { emptyNotificationService, type NotificationService } from "@/services/notifications";
import { TransactionProvider } from "@/features/transactions/TransactionProvider";
import type { TransactionService } from "@/services/transactions";
import { EarlyAccessProvider } from "@/features/access/EarlyAccessProvider";
import type { EarlyAccessService } from "@/services/earlyAccess";
import { InvestmentProvider } from "@/features/investments/InvestmentProvider";
import type { InvestmentService } from "@/services/investments";
import {
  DarkTheme,
  NavigationContainer,
  useNavigationContainerRef,
} from "@react-navigation/native";
import { PostHogProvider } from "posthog-react-native";
import { analytics } from "@/services/analytics";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { RootNavigator } from "@/navigation/RootNavigator";
import colors from "@/theme/colors.json";
import { SessionProvider, useSession } from "./SessionProvider";
import type { AccessService, WalletSession } from "@/services/access";
import { createLinking } from "@/navigation/linking";
import type { RootStackParamList } from "@/navigation/types";
import { ErrorBoundary } from "./ErrorBoundary";
const theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.accent,
    background: colors.ink,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
  },
};
function AppNavigation({
  investmentService,
  opportunityService = defaultOpportunityService,
  transactionService,
  accountDependencies,
  notificationService,
  renderNativeSession,
  walletBalanceService,
  walletTransferService,
}: {
  investmentService?: InvestmentService;
  opportunityService?: OpportunityService;
  transactionService?: TransactionService;
  accountDependencies?: AccountDependencies;
  notificationService?: NotificationService;
  renderNativeSession?: (session: WalletSession) => ReactNode;
  walletBalanceService?: WalletBalanceService;
  walletTransferService?: WalletTransferService;
}) {
  const { session } = useSession();
  const navigation = useNavigationContainerRef<RootStackParamList>();
  // Route names only; params can carry account data.
  const trackScreen = () => {
    const route = navigation.getCurrentRoute();
    if (route) void analytics.screen(route.name);
  };
  if ((session?.kind === "testnet" || session?.kind === "mainnet") && renderNativeSession)
    return renderNativeSession(session);
  return (
    <NavigationContainer
      key={
        session
          ? `${session.kind}:${session.accountId ?? "default"}:${session.kind !== "demo" ? session.chainId : "demo"}`
          : "guest"
      }
      ref={navigation}
      onReady={trackScreen}
      onStateChange={trackScreen}
      theme={theme}
      linking={createLinking(!!session)}
    >
      {session?.kind === "mainnet" ? (
        <MainnetWalletProvider session={session}>
          <OpportunityServiceContext.Provider value={opportunityService}>
            <AccountProvider {...accountDependencies}>
              <NotificationProvider service={emptyNotificationService}>
                <RootNavigator />
              </NotificationProvider>
            </AccountProvider>
          </OpportunityServiceContext.Provider>
        </MainnetWalletProvider>
      ) : session?.kind === "testnet" ? (
        <WalletProvider
          session={session}
          balance={walletBalanceService}
          transfers={walletTransferService}
        >
          <OpportunityServiceContext.Provider value={opportunityService}>
            <AccountProvider {...accountDependencies}>
              <NotificationProvider service={emptyNotificationService}>
                <RootNavigator />
              </NotificationProvider>
            </AccountProvider>
          </OpportunityServiceContext.Provider>
        </WalletProvider>
      ) : session ? (
        <InvestmentProvider service={investmentService}>
          <TransactionProvider service={transactionService}>
            <AccountProvider {...accountDependencies}>
              <NotificationProvider service={notificationService}>
                <RootNavigator />
              </NotificationProvider>
            </AccountProvider>
          </TransactionProvider>
        </InvestmentProvider>
      ) : (
        <RootNavigator />
      )}
    </NavigationContainer>
  );
}
export function AppRoot({
  accessService,
  earlyAccessService,
  investmentService,
  opportunityService = defaultOpportunityService,
  transactionService,
  accountDependencies,
  notificationService,
  renderNativeSession,
  walletBalanceService,
  walletTransferService,
}: {
  accessService?: AccessService;
  earlyAccessService?: EarlyAccessService;
  investmentService?: InvestmentService;
  opportunityService?: OpportunityService;
  transactionService?: TransactionService;
  accountDependencies?: AccountDependencies;
  notificationService?: NotificationService;
  renderNativeSession?: (session: WalletSession) => ReactNode;
  walletBalanceService?: WalletBalanceService;
  walletTransferService?: WalletTransferService;
}) {
  return (
    <PostHogProvider client={analytics} autocapture={false}>
      <SafeAreaProvider>
        <ErrorBoundary>
          <SessionProvider accessService={accessService}>
            <EarlyAccessProvider service={earlyAccessService}>
              <StatusBar style="light" />
              <AppNavigation
                walletTransferService={walletTransferService}
                walletBalanceService={walletBalanceService}
                renderNativeSession={renderNativeSession}
                accountDependencies={accountDependencies}
                notificationService={notificationService}
                opportunityService={opportunityService}
                investmentService={investmentService}
                transactionService={transactionService}
              />
            </EarlyAccessProvider>
          </SessionProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </PostHogProvider>
  );
}
