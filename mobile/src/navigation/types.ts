import type { AccountPage } from "@/features/account/pages";
import type { OperationKind } from "@/domain/transactions";
import type { NavigatorScreenParams } from "@react-navigation/native";
export type MainTabParamList = {
  Home: undefined;
  Vaults: undefined;
  Exchange: undefined;
  Settings: undefined;
};
export type RootStackParamList = {
  Welcome: undefined;
  Access: undefined;
  RequestAccess: undefined;
  Main: NavigatorScreenParams<MainTabParamList>;
  VaultDetail: { id: string };
  OpportunityDetail: { id: string };
  Activity: undefined;
  Notifications: undefined;
  AccountPage: { page: AccountPage };
  Transaction: { kind?: OperationKind; vaultId?: string; resume?: boolean };
};
