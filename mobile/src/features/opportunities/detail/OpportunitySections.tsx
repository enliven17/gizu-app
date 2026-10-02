import { Text, View, useWindowDimensions } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Surface } from "@/components/molecules/Surface";
import type { OpportunityCampaign, OpportunityDetail } from "@/domain/opportunities";
import { sectionDelay } from "@/theme/motion";
import { money, percent, unixDate } from "../format";
import { DetailSection, KeyValueRow } from "./DetailRows";

const tabular = { fontVariant: ["tabular-nums" as const] };

function HowTo({ steps }: { steps: string[] }) {
  const { fontScale } = useWindowDimensions();
  return (
    <Surface>
      {steps.map((step, index) => (
        <View
          key={`${index}-${step}`}
          className="flex-row gap-3 border-b border-divider px-5 py-4"
          accessible
          accessibilityLabel={`Step ${index + 1}: ${step}`}
        >
          <Text key={fontScale} className="font-sans text-[12px] text-neon/70" style={tabular}>
            {index + 1}
          </Text>
          <Typography variant="rowValue" className="min-w-0 flex-1 !text-fg-70">
            {step}
          </Typography>
        </View>
      ))}
    </Surface>
  );
}

function Tokens({ tokens }: { tokens: OpportunityDetail["tokens"] }) {
  return (
    <Surface>
      {tokens.map((token) => (
        <View
          key={token.id}
          className="flex-row items-center justify-between gap-3 border-b border-divider px-5 py-4"
          accessible
          accessibilityLabel={`${token.symbol}, ${money.format(token.price)}, ${token.address}`}
        >
          <View className="min-w-0 flex-1 gap-1">
            <Typography variant="rowValue" className="!text-fg-85">
              {token.symbol}
            </Typography>
            <Typography variant="micro" numberOfLines={1} ellipsizeMode="middle">
              {token.address}
            </Typography>
          </View>
          <Typography variant="rowValue" className="!text-[13px] !text-fg-55" style={tabular}>
            {money.format(token.price)}
          </Typography>
        </View>
      ))}
    </Surface>
  );
}

function Campaign({ campaign }: { campaign: OpportunityCampaign }) {
  const rows = [
    ["Daily rewards", money.format(campaign.dailyRewards)],
    ["Start", unixDate(campaign.startTimestamp)],
    ["End", unixDate(campaign.endTimestamp)],
    ["Creator", campaign.creatorAddress],
    ["Campaign id", campaign.campaignId],
  ] as const;
  return (
    <Surface>
      <View className="flex-row items-center justify-between gap-3 px-5 pt-5">
        <Typography variant="rowTitle" className="shrink !text-neon/80">
          {campaign.type}
        </Typography>
        <Typography variant="rowValue" className="!text-[13px] !text-fg-85" style={tabular}>
          {`${percent.format(campaign.apr)}%`}
        </Typography>
      </View>
      <View className="gap-2 px-5 pb-5 pt-3">
        {rows.map(([label, value]) => (
          <View
            key={label}
            className="flex-row justify-between gap-3"
            accessible
            accessibilityLabel={`${label}: ${value}`}
          >
            <Typography variant="micro" className="!text-fg-45">
              {label}
            </Typography>
            <Typography
              variant="micro"
              numberOfLines={1}
              ellipsizeMode="middle"
              className="min-w-0 shrink text-right !text-fg-70"
              style={tabular}
            >
              {value}
            </Typography>
          </View>
        ))}
      </View>
    </Surface>
  );
}

/** Frontend OpportunityDetail body sections: about, how-to, tokens, details, campaigns. */
export function OpportunitySections({ opportunity }: { opportunity: OpportunityDetail }) {
  const details: [string, string][] = [
    ["Type", opportunity.type],
    ["Identifier", opportunity.identifier],
    ["Explorer", opportunity.explorerAddress],
    ["Opportunity id", opportunity.id],
  ];
  if (opportunity.vaultAddress) details.unshift(["Vault contract", opportunity.vaultAddress]);
  if (opportunity.symbol) details.unshift(["Share symbol", opportunity.symbol]);
  if (opportunity.tags.length > 0) details.push(["Tags", opportunity.tags.join(", ")]);
  return (
    <>
      {opportunity.description.length > 0 && (
        <DetailSection title="About" delay={sectionDelay(4)}>
          <Surface>
            <Typography variant="rowValue" className="p-5 leading-[22px] !text-fg-70">
              {opportunity.description}
            </Typography>
          </Surface>
        </DetailSection>
      )}
      {opportunity.howToSteps.length > 0 && (
        <DetailSection title="How to" delay={sectionDelay(5)}>
          <HowTo steps={opportunity.howToSteps} />
        </DetailSection>
      )}
      {opportunity.tokens.length > 0 && (
        <DetailSection title="Tokens" delay={sectionDelay(6)}>
          <Tokens tokens={opportunity.tokens} />
        </DetailSection>
      )}
      <DetailSection title="Details" delay={sectionDelay(7)}>
        <Surface>
          {details.map(([label, value]) => (
            <KeyValueRow key={label} label={label} value={value} />
          ))}
        </Surface>
      </DetailSection>
      {opportunity.campaigns.length > 0 && (
        <DetailSection title="Campaigns" delay={sectionDelay(8)}>
          <View className="gap-3">
            {opportunity.campaigns.map((campaign) => (
              <Campaign key={campaign.id} campaign={campaign} />
            ))}
          </View>
        </DetailSection>
      )}
    </>
  );
}
