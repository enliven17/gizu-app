import { WalletBackupAction } from "./WalletBackupAction";
import { View } from "react-native";
import { Fingerprint, ShieldCheck, Bell, Globe, FileText, LifeBuoy } from "lucide-react-native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { useSession } from "@/application/SessionProvider";
import { profileFixture as profile } from "@/services/fixtures/profile";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import { AccountAddress } from "@/features/account/AccountAddress";
import { PreferenceFeedback } from "@/features/account/PreferenceFeedback";
import { useAccount } from "@/features/account/AccountProvider";
import type { AccountPage } from "@/features/account/pages";
const groups = [
  {
    title: "Security",
    rows: [
      { page: "passkey-wallet" as AccountPage, label: "Passkey wallet", icon: Fingerprint },
      {
        page: "transaction-signing" as AccountPage,
        label: "Transaction signing",
        icon: ShieldCheck,
      },
      { page: "alerts" as AccountPage, label: "Push alerts", icon: Bell },
    ],
  },
  {
    title: "Preferences",
    rows: [
      { page: "currency" as AccountPage, label: "Currency", icon: Globe },
      { page: "statements" as AccountPage, label: "Statements", icon: FileText },
    ],
  },
  {
    title: "Support",
    rows: [
      { page: "contact-desk" as AccountPage, label: "Contact desk", icon: LifeBuoy },
      { page: "terms" as AccountPage, label: "Terms and disclosures", icon: FileText },
    ],
  },
];
export function AccountScreen({ navigation }: BottomTabScreenProps<MainTabParamList, "Settings">) {
  const { session } = useSession();
  const native = session?.kind === "testnet";
  const { preferences, busy, disconnectAccount } = useAccount();
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <Screen>
      <Typography variant="title">Account</Typography>
      <Surface>
        <View className="flex-row items-center gap-4 p-5">
          <View className="rounded-2xl bg-accent/10 p-4">
            <Typography variant="label">{native ? "G" : profile.initials}</Typography>
          </View>
          <View className="flex-1 gap-1">
            <Typography variant="row">{native ? "Account 0" : profile.name}</Typography>
            <Typography variant="caption">{native ? "Monad testnet" : profile.member}</Typography>
          </View>
        </View>
        <AccountAddress />
      </Surface>
      <Typography variant="caption">
        Access method: {session?.method === "Demo passkey" ? "Passkey" : session?.method}
      </Typography>
      {session?.kind === "testnet" && session.walletId && <WalletBackupAction />}
      <PreferenceFeedback />
      {groups.map((group) => (
        <View key={group.title} className="gap-3">
          <Typography variant="caption">{group.title}</Typography>
          <Surface>
            {group.rows.map((row) => (
              <GroupedRow
                key={row.label}
                {...row}
                value={
                  row.page === "currency"
                    ? native
                      ? "MON"
                      : "USD"
                    : row.page === "statements"
                      ? preferences?.statements
                      : undefined
                }
                onPress={() => root.navigate("AccountPage", { page: row.page })}
              />
            ))}
          </Surface>
        </View>
      ))}

      <Button
        variant="destructive"
        label="Disconnect"
        disabled={busy}
        onPress={() => void disconnectAccount()}
      />
      <Typography variant="caption">Gizu v0.1.0</Typography>
    </Screen>
  );
}
