import { View } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Button } from "@/components/atoms/Button";
import { Choice } from "@/components/molecules/Choice";
import { FadeIn } from "@/components/molecules/FadeIn";
import { VaultGrid } from "@/components/organisms/VaultList";
import { opportunityProtocols } from "@/domain/opportunities";
import { sectionDelay } from "@/theme/motion";
import { useOpportunities } from "./useOpportunities";
import { CatalogStatus } from "./components/CatalogStatus";
import { OpportunityCard } from "./components/OpportunityCard";
import { PagerButton } from "@/components/molecules/PagerButton";
const labels = { all: "All protocols", aave: "Aave", morpho: "Morpho", curvance: "Curvance" };
export function MainnetVaults({ onOpen }: { onOpen: (id: string) => void }) {
  const { query, load, change, retry } = useOpportunities();
  const filtered = query.search !== "" || query.protocol !== "all";
  return (
    <Screen>
      <FadeIn delay={sectionDelay(0)} className="gap-2 pb-2">
        <Typography variant="pageTitle">Confidential vaults</Typography>
      </FadeIn>
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
      {filtered && (
        <View className="self-start">
          <Button
            label="Clear filters"
            variant="quiet"
            onPress={() => change({ search: "", protocol: "all", page: 0 })}
          />
        </View>
      )}
      {load.kind === "loading" && (
        <CatalogStatus accessibilityLiveRegion="polite">Loading vaults…</CatalogStatus>
      )}
      {load.kind === "failed" && (
        <View className="gap-3">
          <CatalogStatus accessibilityRole="alert">
            Vault catalog unavailable. Please retry.
          </CatalogStatus>
          <Button label="Retry vaults" variant="secondary" onPress={retry} />
        </View>
      )}
      {load.kind === "ready" && (
        <>
          {load.data.list.length === 0 && (
            <CatalogStatus>No vaults match your filters.</CatalogStatus>
          )}
          <VaultGrid>
            {load.data.list.map((item, index) => (
              <OpportunityCard
                key={item.id}
                opportunity={item}
                index={index}
                rateSuffix=" total APR"
                onOpen={onOpen}
              />
            ))}
          </VaultGrid>
        </>
      )}
      <View className="flex-row items-center justify-between gap-3 pt-2">
        <PagerButton
          label="Prev"
          accessibilityLabel="Previous page"
          disabled={load.kind !== "ready" || query.page === 0}
          onPress={() => change({ ...query, page: query.page - 1 })}
        />
        <Typography variant="micro" accessibilityLabel={`Page ${query.page + 1}`}>
          {query.page + 1}
        </Typography>
        <PagerButton
          label="Next"
          accessibilityLabel="Next page"
          disabled={load.kind !== "ready" || (query.page + 1) * load.data.items >= load.data.total}
          onPress={() => change({ ...query, page: query.page + 1 })}
        />
      </View>
    </Screen>
  );
}
