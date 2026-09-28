import { Keyboard, TextInput } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { useNativeTransferController } from "./useNativeTransferController";
import type { NativeTransfers } from "@/development/legacySigner/nativeBridge";

export function NativeTransferScreen({
  service,
  onBack,
}: {
  service: NativeTransfers | null;
  onBack(): void;
}) {
  const c = useNativeTransferController(service);
  return (
    <Screen>
      <Typography variant="title">Native testnet transfers</Typography>
      <Typography>
        Monad testnet · chain 10143. Existing test passkeys only. This is separate from the
        investment demo.
      </Typography>
      <Typography>
        {service ? c.message : "Rebuild the development client to enable native transfers."}
      </Typography>
      <Typography>Account index (0–15)</Typography>
      <TextInput
        accessibilityLabel="Account index"
        value={c.account}
        onChangeText={c.setAccount}
        editable={!c.busy}
        keyboardType="number-pad"
        className="rounded-2xl border border-border p-4 text-text"
      />
      <Typography>Recipient address</Typography>
      <TextInput
        accessibilityLabel="Recipient address"
        value={c.recipient}
        onChangeText={c.setRecipient}
        editable={!c.busy}
        autoCapitalize="none"
        autoCorrect={false}
        className="rounded-2xl border border-border p-4 text-text"
      />
      <Typography>Amount per transfer in testnet MON (maximum 0.1)</Typography>
      <TextInput
        accessibilityLabel="Amount in MON"
        value={c.amount}
        onChangeText={c.setAmount}
        editable={!c.busy}
        keyboardType="decimal-pad"
        className="rounded-2xl border border-border p-4 text-text"
      />
      <Typography>Number of transfers (1–16)</Typography>
      <TextInput
        accessibilityLabel="Number of transfers"
        value={c.count}
        onChangeText={c.setCount}
        editable={!c.busy}
        keyboardType="number-pad"
        className="rounded-2xl border border-border p-4 text-text"
      />
      <Typography>
        Each transfer sends the entered amount to the same recipient. One unlock and native review
        cover the batch. Transfers are sequential; cancelling cannot undo completed transfers.
      </Typography>
      <Button
        label="Review native transfer"
        disabled={!service || c.busy}
        onPress={() => {
          Keyboard.dismiss();
          void c.review();
        }}
      />
      <Button
        label="Refresh native status"
        disabled={!service || c.busy}
        onPress={() => void c.refresh()}
      />
      {c.results.map((r) => (
        <Typography key={r.transactionHash}>
          {r.status}: {r.transactionHash}
        </Typography>
      ))}
      <Button label="Back to native probe" onPress={onBack} />
    </Screen>
  );
}
