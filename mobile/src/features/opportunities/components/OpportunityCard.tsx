import { VaultCard } from "@/components/organisms/VaultList";
import { tvlChange, type Opportunity } from "@/domain/opportunities";
import { useTvlSeries } from "../useTvlSeries";
import { money, percent } from "../format";
import { protocolLogo } from "../protocolLogos";

/** No history yet: a flat line at zero rather than an empty-state message. */
const flat = [0, 0];

/**
 * Frontend OpportunityCard for a real mainnet catalog row: ticker chip, TVL sparkline,
 * name, TVL and total APR. History loads lazily per card; a failed request just omits
 * the sparkline so the list is never blocked.
 */
export function OpportunityCard({
  opportunity,
  index,
  rateSuffix,
  onOpen,
  virtualized = false,
}: {
  opportunity: Opportunity;
  index: number;
  virtualized?: boolean;
  /** Small suffix after the rate, e.g. ` total APR` on the Vaults tab. */
  rateSuffix?: string;
  onOpen: (id: string) => void;
}) {
  const history = useTvlSeries(opportunity.id);
  const tvl = money.format(opportunity.tvl);
  const apr = percent.format(opportunity.totalApr);
  let series: number[] | undefined;
  if (history.kind === "ready") series = history.series.length >= 2 ? history.series : flat;
  const change = series ? tvlChange(series) : null;
  const up = change === null || change >= 0;
  return (
    <VaultCard
      index={index}
      virtualized={virtualized}
      ticker={opportunity.protocol.name.slice(0, 4)}
      logo={protocolLogo(opportunity.protocol.name)}
      name={opportunity.name}
      tvl={tvl}
      rate={`${apr}%`}
      rateSuffix={rateSuffix}
      trailing={change === null ? opportunity.status : `${up ? "+" : ""}${percent.format(change)}%`}
      trailingTone={change === null ? "muted" : up ? "positive" : "negative"}
      series={series}
      negative={!up}
      accessibilityLabel={`View ${opportunity.name}`}
      accessibilityHint={`${opportunity.protocol.name}, ${opportunity.status}, TVL ${tvl}, total APR ${apr} percent`}
      onPress={() => onOpen(opportunity.id)}
    />
  );
}
