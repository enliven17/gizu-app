import { useState } from "react";
import { Text, TextInput, View, useWindowDimensions } from "react-native";
import { Card } from "@/components/molecules/Card";
import { PeriodPills } from "@/components/molecules/chart/PeriodPills";
import { Typography } from "@/components/atoms/Typography";
import {
  estimateEarnings,
  estimatePeriods,
  parseEstimateAmount,
  type EstimatePeriod,
} from "@/domain/earn/estimate";
import colors from "@/theme/colors.json";
import { rate } from "../format";

const usd = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const periods = Object.keys(estimatePeriods) as EstimatePeriod[];
const periodNames: Record<EstimatePeriod, string> = {
  "1M": "1 month",
  "6M": "6 months",
  "1Y": "1 year",
};
const tabular = { fontVariant: ["tabular-nums" as const] };

/** "Put in X, get back Y": projection at the vault's current rate. */
export function EarningsEstimate({
  ratePercent,
  rateType,
}: {
  ratePercent: number | null;
  rateType: "apy" | "apr";
}) {
  const { fontScale } = useWindowDimensions();
  const [input, setInput] = useState("1000");
  const [period, setPeriod] = useState<EstimatePeriod>("1Y");
  const amount = parseEstimateAmount(input);
  const result =
    amount !== null && ratePercent !== null
      ? estimateEarnings(amount, ratePercent, rateType, period)
      : null;
  return (
    <Card title="Estimated earnings" meta={`at ${rate(ratePercent)} ${rateType.toUpperCase()}`}>
      <View className="gap-2">
        <Typography variant="label11">You deposit</Typography>
        <View className="min-h-14 flex-row items-center rounded-2xl bg-well px-4">
          <Text key={fontScale} className="font-sans text-[22px] text-fg-45">
            $
          </Text>
          <TextInput
            accessibilityLabel="Deposit amount in USD"
            value={input}
            onChangeText={setInput}
            keyboardType="decimal-pad"
            inputMode="decimal"
            maxLength={16}
            selectionColor={colors.accent}
            placeholder="0.00"
            placeholderTextColor={colors.fg["35"]}
            className="font-sans flex-1 py-3 pl-1 text-[22px] text-text"
            style={tabular}
          />
        </View>
        {input !== "" && amount === null && (
          <Typography variant="micro" className="!text-danger" accessibilityRole="alert">
            Enter an amount up to $1,000,000,000 with at most two decimals.
          </Typography>
        )}
      </View>
      <PeriodPills
        options={periods}
        selected={period}
        onSelect={setPeriod}
        label="Estimate period"
      />
      <View
        className="flex-row items-end justify-between gap-3 rounded-2xl bg-well p-4"
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={
          result
            ? `After ${periodNames[period]}: about $${usd.format(result.total)}, earning $${usd.format(result.earned)}`
            : "Estimate unavailable"
        }
      >
        <View className="min-w-0 flex-1 gap-1">
          <Typography variant="label11">{`You get after ${periodNames[period]}`}</Typography>
          <Text
            key={fontScale}
            numberOfLines={1}
            adjustsFontSizeToFit
            className="font-sans text-[26px] text-text"
            style={tabular}
          >
            {result ? `$${usd.format(result.total)}` : "—"}
          </Text>
        </View>
        {result && (
          <Text
            key={`earned-${fontScale}`}
            className="font-sans mb-1 text-[14px] text-neon"
            style={tabular}
          >
            {`+$${usd.format(result.earned)}`}
          </Text>
        )}
      </View>
      <Typography variant="micro">
        {ratePercent === null
          ? "This vault has no current rate, so earnings can’t be estimated."
          : "Estimate only. Rates change and returns are not guaranteed; fees are not included."}
      </Typography>
    </Card>
  );
}
