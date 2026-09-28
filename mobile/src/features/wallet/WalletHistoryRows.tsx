import { View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import { formatMon } from "@/domain/wallet/amounts";
import type { WalletTransfer } from "@/domain/wallet/types";
const labels: Record<string, string> = {
  pending: "Pending",
  signed: "Signed — approval required to retry",
  unknown: "Unknown — refresh status",
  finalized: "Finalized",
  reverted: "Failed on-chain",
};
export function WalletHistoryRows({ entries }: { entries: WalletTransfer[] }) {
  return (
    <>
      {entries.map((entry) => (
        <Surface key={entry.transactionHash}>
          <View className="gap-2 p-5">
            <Typography variant="row">{labels[entry.status]}</Typography>
            {entry.valueWei && entry.to ? (
              <>
                <Typography>{formatMon(entry.valueWei)} MON</Typography>
                <Typography selectable>To: {entry.to}</Typography>
              </>
            ) : (
              <Typography variant="caption">
                Earlier transfer — amount and recipient details were not saved.
              </Typography>
            )}
            <Typography variant="caption">Nonce {entry.nonce}</Typography>
            <Typography
              selectable
              accessibilityLabel={"Transaction hash: " + entry.transactionHash}
            >
              {entry.transactionHash}
            </Typography>
          </View>
        </Surface>
      ))}
    </>
  );
}
