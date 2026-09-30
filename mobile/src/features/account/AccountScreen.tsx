import { View } from "react-native";
import { Fingerprint, ShieldCheck, Bell, Globe, FileText, LifeBuoy } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { FadeIn } from "@/components/molecules/FadeIn";
import { Surface } from "@/components/molecules/Surface";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { useSession } from "@/application/SessionProvider";
import { profileFixture as profile } from "@/services/fixtures/profile";
import type { MainTabParamList, RootStackParamList } from "@/navigation/types";
import type { Preferences } from "@/domain/preferences";
import { sectionDelay } from "@/theme/motion";
import { AccountAddress } from "./AccountAddress";
import { PreferenceFeedback } from "./PreferenceFeedback";
import { useAccount } from "./AccountProvider";
import { WalletBackupAction } from "./WalletBackupAction";
import { SettingsGroup } from "./components/SettingsGroup";
import { AccountInitials } from "./components/AccountInitials";
import type { AccountPage } from "./pages";

type Row = { page: AccountPage; label: string; icon: LucideIcon };

const groups: { title: string; rows: Row[] }[] = [
  {
    title: "Security",
    rows: [
      { page: "passkey-wallet", label: "Passkey wallet", icon: Fingerprint },
      { page: "transaction-signing", label: "Transaction signing", icon: ShieldCheck },
      { page: "alerts", label: "Push alerts", icon: Bell },
    ],
  },
  {
    title: "Preferences",
    rows: [
      { page: "currency", label: "Currency", icon: Globe },
      { page: "statements", label: "Statements", icon: FileText },
    ],
  },
  {
    title: "Support",
    rows: [
      { page: "contact-desk", label: "Contact desk", icon: LifeBuoy },
      { page: "terms", label: "Terms and disclosures", icon: FileText },
    ],
  },
];

function rowValue(page: AccountPage, native: boolean, preferences: Preferences | null) {
  if (page === "currency") return native ? "MON" : "USD";
  if (page === "statements") return preferences?.statements;
  if (page === "alerts" && preferences) return preferences.alerts ? "On" : "Off";
  return undefined;
}

// Frontend Settings: title, glass identity card, groups staggered 60ms, glass Disconnect.
export function AccountScreen({ navigation }: BottomTabScreenProps<MainTabParamList, "Settings">) {
  const { session } = useSession();
  const native = session?.kind === "testnet" || session?.kind === "mainnet";
  const { preferences, busy, disconnectAccount } = useAccount();
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>();
  const method = session?.method === "Demo passkey" ? "Passkey" : session?.method;
  return (
    <Screen>
      <FadeIn delay={sectionDelay(0)} className="mt-6">
        <Typography variant="pageTitle">Account</Typography>
      </FadeIn>
      <FadeIn delay={sectionDelay(1)} className="mt-2 gap-4">
        <Surface>
          <View className="pt-5">
            <AccountAddress
              leading={<AccountInitials initials={native ? undefined : profile.initials} />}
              heading={
                <>
                  <Typography variant="rowTitle" className="!text-[16px]">
                    {session?.kind === "mainnet"
                      ? "Swap funding account"
                      : native
                        ? "Account 0"
                        : profile.name}
                  </Typography>
                  <Typography variant="micro">Access method: {method}</Typography>
                </>
              }
            />
          </View>
        </Surface>
        {native && session.walletId && <WalletBackupAction />}
        <PreferenceFeedback />
      </FadeIn>
      {groups.map((group, index) => (
        <SettingsGroup key={group.title} title={group.title} delay={sectionDelay(index + 2)}>
          {group.rows.map((row, rowIndex) => (
            <GroupedRow
              key={row.page}
              last={rowIndex === group.rows.length - 1}
              label={row.label}
              icon={row.icon}
              value={rowValue(row.page, native, preferences)}
              onPress={() => root.navigate("AccountPage", { page: row.page })}
            />
          ))}
        </SettingsGroup>
      ))}
      <FadeIn delay={sectionDelay(groups.length + 2)} className="mt-5">
        <Button
          variant="destructive"
          label="Disconnect"
          disabled={busy}
          onPress={() => void disconnectAccount()}
        />
      </FadeIn>
    </Screen>
  );
}
