import { useSession } from "@/application/SessionProvider";
import { NativeActivity } from "./NativeActivity";
import { useTransactions } from "@/features/transactions/TransactionProvider";
import { OperationLink } from "@/features/transactions/OperationLink";
import { operationLabels } from "@/domain/transactions";
import { BackAction } from "@/navigation/BackAction";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { Metric } from "@/components/molecules/Metric";
import { useInvestments } from "./InvestmentProvider";
import { DataStatus } from "./DataStatus";
export function ActivityScreen() {
  const { session } = useSession();
  return session?.kind === "testnet" || session?.kind === "mainnet" ? (
    <NativeActivity />
  ) : (
    <DemoActivity />
  );
}
function DemoActivity() {
  const { data } = useInvestments();
  const { history } = useTransactions();
  return (
    <Screen>
      <BackAction fallback="Home" />
      <Typography variant="heading">Activity</Typography>
      <DataStatus />
      <OperationLink />
      {history.map((item) => (
        <Metric
          key={item.key}
          label={`${operationLabels[item.quote.input.kind]} · ${item.key}`}
          value={`${item.quote.input.amount} ${item.quote.from} · ${item.status}`}
        />
      ))}
      {data && (
        <>
          {data.activity.length === 0 && history.length === 0 && (
            <Typography>No activity yet.</Typography>
          )}
          {data.activity.map((item) => (
            <Metric key={item.id} label={`${item.month} · ${item.label}`} value={`${item.value}`} />
          ))}
        </>
      )}
    </Screen>
  );
}
