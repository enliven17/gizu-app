import { Typography } from "@/components/atoms/Typography";
import { Button } from "@/components/atoms/Button";
import { Notice } from "@/components/molecules/Notice";
import { Surface } from "@/components/molecules/Surface";
import { View } from "react-native";
import { decimal, operationLabels } from "@/domain/transactions";
import { useTransactions } from "./TransactionProvider";
const labels = {
  signing: "Awaiting signature",
  submitting: "Submitting operation",
  pending: "Confirmation pending",
  unknown: "Submission status unknown",
  confirmed: "Operation confirmed",
  failed: "Operation failed",
  rejected: "Signing rejected",
};
export function OperationFeedback({ onReview }: { onReview: () => void }) {
  // Cancel signing lives on the sign overlay that covers this view while signing.
  const { operation, checking, checkStatus, error, loading, refresh } = useTransactions();
  if (!operation) return <Typography>No operation to display.</Typography>;
  const { phase, quote, key } = operation;
  return (
    <>
      <Typography variant="heading">{labels[phase]}</Typography>
      <Surface>
        <View className="gap-3 p-5">
          <Typography variant="row">
            {operationLabels[quote.input.kind]} · {quote.input.amount} {quote.from}
          </Typography>
          <Typography>
            Receive {decimal(quote.credit)} {quote.to}
          </Typography>
          <Typography variant="caption">Reference: {key}</Typography>
        </View>
      </Surface>
      {operation.message && (
        <Notice error={phase === "failed" || phase === "rejected"} message={operation.message} />
      )}
      {["signing", "submitting", "pending", "unknown"].includes(phase) && (
        <Typography>
          Closing this screen does not cancel the operation. Reopen its status from Home or
          Activity.
        </Typography>
      )}
      {(phase === "pending" || phase === "unknown") && (
        <Button
          label={checking ? "Checking status" : "Check status"}
          loading={checking}
          onPress={() => void checkStatus()}
        />
      )}
      {phase === "confirmed" && !error && !loading && (
        <Typography>Balances have been updated after confirmation.</Typography>
      )}
      {error && (
        <>
          <Notice error message={error} />
          <Button label="Reload balances" onPress={() => void refresh()} />
        </>
      )}
      {(phase === "failed" || phase === "rejected") && (
        <Button label="Review again" onPress={onReview} />
      )}
    </>
  );
}
