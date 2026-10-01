import { useSession } from "@/application/SessionProvider";
import { Switch, View } from "react-native";
import { Bell } from "lucide-react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "@/navigation/types";
import type { StatementFrequency } from "@/domain/preferences";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { FadeIn } from "@/components/molecules/FadeIn";
import { GroupedRow } from "@/components/molecules/GroupedRow";
import { PreferenceOption } from "@/components/molecules/PreferenceOption";
import { BackAction } from "@/navigation/BackAction";
import { sectionDelay } from "@/theme/motion";
import colors from "@/theme/colors.json";
import { useAccount } from "./AccountProvider";
import { AccountAddress } from "./AccountAddress";
import { PreferenceFeedback } from "./PreferenceFeedback";
import { SettingsGroup } from "./components/SettingsGroup";
import { PageIntro } from "./components/PageIntro";
import {
  informationPages,
  nativeInformationPages,
  mainnetInformationPages,
  testnetInformationPages,
  type AccountPage,
} from "./pages";

const frequencies: StatementFrequency[] = ["Monthly", "Quarterly", "On request"];

function PageActions({ labels, delay }: { labels: string[]; delay: number }) {
  return (
    <FadeIn delay={delay} className="mt-5 gap-3">
      {labels.map((label) => (
        <Button key={label} label={label} disabled onPress={() => {}} />
      ))}
    </FadeIn>
  );
}

function InformationPage({ page, native }: { page: AccountPage; native: boolean }) {
  const { session } = useSession();
  const walletPages =
    session?.kind === "testnet" ? testnetInformationPages : mainnetInformationPages;
  const info = (native ? walletPages[page] : undefined) ?? informationPages[page];
  if (!info) return null;
  return (
    <>
      <PageIntro title={info.title} body={info.body} />
      {info.rows.length > 0 && (
        <SettingsGroup delay={sectionDelay(1)}>
          {info.rows.map((row, index) => (
            <GroupedRow key={row.label} {...row} last={index === info.rows.length - 1} />
          ))}
        </SettingsGroup>
      )}
      {page === "passkey-wallet" && (
        <SettingsGroup title="Account address" delay={sectionDelay(2)}>
          <View className="pt-5">
            <AccountAddress />
          </View>
        </SettingsGroup>
      )}
      {info.actions && <PageActions labels={info.actions} delay={sectionDelay(3)} />}
    </>
  );
}

function AlertsPage() {
  const { preferences, loading, busy, save } = useAccount();
  const unavailable = loading || busy || !preferences;
  const enabled = preferences?.alerts ?? false;
  return (
    <>
      <PageIntro
        title="Push alerts"
        body="Saved on this device. Push delivery is not available yet, so this does not request system permission."
      />
      <PreferenceFeedback />
      <SettingsGroup delay={sectionDelay(1)}>
        <View className="min-h-14 flex-row items-center gap-3 px-5 py-4">
          <Bell size={18} color={colors.fg["45"]} />
          <Typography variant="rowTitle" className="min-w-0 flex-1">
            Receive push alerts
          </Typography>
          <Switch
            accessible
            accessibilityRole="switch"
            accessibilityLabel="Receive push alerts"
            accessibilityState={{ checked: enabled, disabled: unavailable }}
            value={enabled}
            disabled={unavailable}
            trackColor={{ false: colors.fg["20"], true: colors.neon.DEFAULT }}
            thumbColor={enabled ? colors.ink : colors.fg["85"]}
            ios_backgroundColor={colors.fg["20"]}
            onValueChange={(alerts) => void save({ alerts })}
          />
        </View>
      </SettingsGroup>
    </>
  );
}

function CurrencyPage({ native }: { native: boolean }) {
  const { session } = useSession();
  const asset = session?.kind === "mainnet" ? "USDC" : "MON";
  const currencies = native ? [asset] : ["USD", "EUR", "GBP", "TRY"];
  const selected = native ? asset : "USD";
  return (
    <>
      <PageIntro
        title="Currency"
        body={
          native
            ? `Balances are shown in ${asset}. Fiat values are not available yet.`
            : "USD is the only display currency for now."
        }
      />
      <PreferenceFeedback />
      <SettingsGroup delay={sectionDelay(1)}>
        {currencies.map((currency) => (
          <PreferenceOption
            key={currency}
            label={currency}
            selected={currency === selected}
            disabled
            onSelect={() => {}}
          />
        ))}
      </SettingsGroup>
    </>
  );
}

function StatementsPage() {
  const { preferences, loading, busy, save } = useAccount();
  const unavailable = loading || busy || !preferences;
  return (
    <>
      <PageIntro title="Statements" body="Statement delivery is not available yet." />
      <PreferenceFeedback />
      <SettingsGroup title="Frequency" delay={sectionDelay(1)}>
        {frequencies.map((frequency) => (
          <PreferenceOption
            key={frequency}
            label={frequency}
            selected={preferences?.statements === frequency}
            disabled={unavailable}
            onSelect={() => void save({ statements: frequency })}
          />
        ))}
      </SettingsGroup>
      <SettingsGroup title="Archive" delay={sectionDelay(2)}>
        <GroupedRow label="No statements available." last />
      </SettingsGroup>
      <PageActions labels={["Request statement"]} delay={sectionDelay(3)} />
    </>
  );
}

// Frontend SubPage: glass back button, 30px title, sections staggered below.
export function AccountPageScreen({
  route,
}: NativeStackScreenProps<RootStackParamList, "AccountPage">) {
  const page = route.params.page;
  const { session } = useSession();
  const native = session?.kind === "testnet" || session?.kind === "mainnet";
  const hasInfo = Boolean(
    (native ? nativeInformationPages[page] : undefined) ?? informationPages[page],
  );
  return (
    <Screen>
      <BackAction fallback="Settings" />
      {hasInfo ? (
        <InformationPage page={page} native={native} />
      ) : page === "alerts" ? (
        <AlertsPage />
      ) : page === "currency" ? (
        <CurrencyPage native={native} />
      ) : page === "statements" ? (
        <StatementsPage />
      ) : (
        <PageIntro title="Page unavailable" body="This account page is not supported." />
      )}
    </Screen>
  );
}
