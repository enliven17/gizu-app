import { View, type TextStyle } from "react-native";
import { Fingerprint } from "lucide-react-native";
import { useSession } from "@/application/SessionProvider";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { Button } from "@/components/atoms/Button";
import { Typography } from "@/components/atoms/Typography";
import { AccessCard } from "@/components/molecules/AccessCard";
import { BackupResult, BackupSteps } from "@/components/molecules/BackupSteps";
import { Notice } from "@/components/molecules/Notice";
import { SignStatus } from "@/components/molecules/SignStatus";
import { Surface } from "@/components/molecules/Surface";
import { Screen } from "@/components/templates/Screen";
import { BackAction } from "@/navigation/BackAction";
import colors from "@/theme/colors.json";
import { sectionDelay } from "@/theme/motion";
import { AccessHeading } from "./components/AccessHeading";
import { Reveal } from "./components/Reveal";
import { useAccessController } from "./useAccessController";

const LOGO_HEIGHT = 32;
const backupSteps = ["Save file", "Reopen & confirm passkey", "Done"] as const;
// Frontend: `text-[15px] leading-relaxed text-white/45`.
const body: TextStyle = { fontSize: 15, lineHeight: 24, color: colors.fg["45"] };

/** Frontend Auth layout: back action, logo, glitch heading, primary passkey action. */
export function AccessScreen() {
  const native = useSession().accessService.method === "Passkey";
  const controller = useAccessController();
  return (
    <View className="flex-1 bg-ink">
      <Screen>
        <BackAction />
        <Reveal delay={sectionDelay(0)} className="mt-4">
          <View className="mb-5">
            <GizuLogo width={(LOGO_HEIGHT * 638) / 866} height={LOGO_HEIGHT} />
          </View>
          <AccessHeading
            lead={native ? "Your mainnet" : "Create"}
            accent={native ? "wallet" : "access"}
          />
          <Typography className="mt-3 max-w-[320px]" style={body}>
            {native
              ? "Create or open your mainnet wallet with a passkey."
              : "Continue with a passkey to access Gizu."}
          </Typography>
        </Reveal>
        <Reveal delay={sectionDelay(1)} className="mt-4 gap-3">
          {native && (
            <Surface>
              <View className="gap-4 p-5">
                <View className="gap-2">
                  <Typography variant="section">Verified backup</Typography>
                  <Typography variant="caption">
                    Save and verify an encrypted backup before first use. Recovery needs both the
                    file and your original passkey.
                  </Typography>
                </View>
                <BackupSteps steps={backupSteps} completed={false} />
                {controller.error && <BackupResult failed message={controller.error} />}
              </View>
            </Surface>
          )}
          <AccessCard
            icon={Fingerprint}
            label={controller.pending ? "Opening access" : "Continue with passkey"}
            loading={controller.pending}
            onPress={() => void controller.start()}
          />
          {controller.canRestore && (
            <Button
              label="Restore wallet from backup"
              variant="secondary"
              disabled={controller.pending}
              onPress={() => void controller.restore()}
            />
          )}
          {!native && controller.error && <Notice error message={controller.error} />}
        </Reveal>
      </Screen>
      {/* Web Auth: the orb covers the screen while the passkey ceremony runs. */}
      {controller.pending && (
        <SignStatus layout="overlay" orb="access" state="signing" label="Waiting for passkey">
          <Button label="Cancel access" variant="quiet" onPress={controller.cancel} />
        </SignStatus>
      )}
    </View>
  );
}
