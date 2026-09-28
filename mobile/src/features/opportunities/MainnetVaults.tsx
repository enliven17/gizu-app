import { View } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Button } from "@/components/atoms/Button";
import { Choice } from "@/components/molecules/Choice";
import { Surface } from "@/components/molecules/Surface";
import { opportunityProtocols } from "@/domain/opportunities";
import { useOpportunities } from "./useOpportunities";
const labels = { all: "All protocols", aave: "Aave", morpho: "Morpho", curvance: "Curvance" };
const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const percent = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export function MainnetVaults() {
  const { query, load, change, retry } = useOpportunities();
  return (
    <Screen>
      <Typography variant="heading">Confidential vaults</Typography>
      <Typography variant="label">Monad mainnet · Browse only</Typography>
      <Typography variant="caption">
        Explore lending and vault opportunities. Deposits and withdrawals are not available here.
        Your wallet remains on Monad testnet.
      </Typography>
      <SearchInput
        label="Search opportunities"
        value={query.search}
        onChangeText={(search) => change({ ...query, search, page: 0 })}
      />
      <View
        className="flex-row flex-wrap gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Protocol filter"
      >
        {opportunityProtocols.map((protocol) => (
          <Choice
            key={protocol}
            label={labels[protocol]}
            selected={query.protocol === protocol}
            onPress={() => change({ ...query, protocol, page: 0 })}
          />
        ))}
      </View>
      {(query.search !== "" || query.protocol !== "all") && (
        <Button
          label="Clear filters"
          variant="quiet"
          onPress={() => change({ search: "", protocol: "all", page: 0 })}
        />
      )}
      {load.kind === "loading" && (
        <Typography accessibilityLiveRegion="polite">Loading vaults…</Typography>
      )}
      {load.kind === "failed" && (
        <>
          <Typography accessibilityRole="alert">
            Vault catalog unavailable. Please retry.
          </Typography>
          <Button label="Retry vaults" onPress={retry} />
        </>
      )}
      {load.kind === "ready" && (
        <>
          <Typography accessibilityLiveRegion="polite">
            {load.data.total} opportunities found
          </Typography>
          {load.data.list.length === 0 && <Typography>No vaults match your filters.</Typography>}
          {load.data.list.map((item) => (
            <Surface key={item.id}>
              <View className="gap-3 p-4">
                <Typography variant="label">
                  {item.protocol.name} · {item.status}
                </Typography>
                <Typography variant="row">{item.name}</Typography>
                <View className="flex-row flex-wrap justify-between gap-2">
                  <Typography>{money.format(item.tvl)} TVL</Typography>
                  <Typography variant="label">
                    {percent.format(item.totalApr)}% total APR
                  </Typography>
                </View>
              </View>
            </Surface>
          ))}
          <Typography variant="caption">
            Catalog data may be cached for up to 5 minutes. APR is variable and is not a guaranteed
            return.
          </Typography>
        </>
      )}
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Button
          label="Previous page"
          variant="secondary"
          disabled={load.kind !== "ready" || query.page === 0}
          onPress={() => change({ ...query, page: query.page - 1 })}
        />
        <Typography>Page {query.page + 1}</Typography>
        <Button
          label="Next page"
          variant="secondary"
          disabled={load.kind !== "ready" || (query.page + 1) * load.data.items >= load.data.total}
          onPress={() => change({ ...query, page: query.page + 1 })}
        />
      </View>
    </Screen>
  );
}
