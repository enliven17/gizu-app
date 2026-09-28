import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Surface } from "@/components/molecules/Surface";
import { useWallet } from "./WalletProvider";

export function WalletOperations() {
  const c = useWallet().transfers;
  return (
    <>
      {c.history.operations
        ?.filter((o) => o.blocked)
        .map((o) => (
          <Surface key={o.operationId}>
            <View className="gap-3 p-5">
              <Typography variant="row">
                Transfer operation · {o.operationId.slice(0, 8)}
              </Typography>
              <Typography>
                {o.steps.filter((s) => s.status === "finalized").length} of {o.steps.length}{" "}
                finalized
              </Typography>
              {o.steps.some((s) => s.nonceConflict) && (
                <Typography>
                  Account nonce changed. This transfer cannot be safely retried. Refresh status; do
                  not submit it again.
                </Typography>
              )}
              {o.canResume && (
                <Button
                  label="Review and resume"
                  disabled={c.busy || !c.ready}
                  onPress={() => void c.resume(o.operationId, o.revision)}
                />
              )}
              {o.status !== "cancelled" && (
                <Button
                  label="Cancel remaining transfers"
                  variant="secondary"
                  disabled={c.busy || !c.ready}
                  onPress={() => void c.cancelOperation(o.operationId)}
                />
              )}
              <Typography variant="caption">
                Resume requires fresh native approval and your passkey. Cancellation cannot undo
                signed or submitted transfers.
              </Typography>
            </View>
          </Surface>
        ))}
    </>
  );
}
