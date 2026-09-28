import { useSession } from "@/application/SessionProvider";
import { GizuLogo } from "@/components/atoms/GizuLogo";
import { Fingerprint } from "lucide-react-native";
import { BackAction } from "@/navigation/BackAction";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Notice } from "@/components/molecules/Notice";
import { AccessCard } from "@/components/molecules/AccessCard";
import { useAccessController } from "./useAccessController";
export function AccessScreen() {
  const native = useSession().accessService.method === "Passkey";
  const controller = useAccessController();
  return (
    <Screen>
      <BackAction />
      <GizuLogo />
      <Typography variant="title">{native ? "Your testnet wallet" : "Create access"}</Typography>
      <Typography>
        {native
          ? "Create or open your Monad testnet wallet. Before first use, save and verify an encrypted backup. Recovery needs both that file and your original passkey."
          : "Continue with a passkey to access Gizu."}
      </Typography>
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
      {controller.error && <Notice error message={controller.error} />}
      {controller.pending && (
        <Button label="Cancel access" variant="secondary" onPress={controller.cancel} />
      )}
    </Screen>
  );
}
