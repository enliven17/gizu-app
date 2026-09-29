import { View } from "react-native";
import { Screen } from "@/components/templates/Screen";
import { Typography } from "@/components/atoms/Typography";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Button } from "@/components/atoms/Button";
import { Choice } from "@/components/molecules/Choice";
import { PagerButton } from "@/components/molecules/PagerButton";
import { tokenIdentity, tokenNetworks } from "@/domain/tokenCatalog";
import { useTokenCatalog } from "./useTokenCatalog";
import { TokenCard } from "./components/TokenCard";
export function SwapScreen() {
  const { query, load, change, retry } = useTokenCatalog();
  return (
    <Screen>
      <Typography variant="pageTitle">Swap</Typography>
      <Typography variant="caption">
        Explore tokens. Quotes and swaps are not available yet. A 1inch listing does not establish
        Fusion availability.
      </Typography>
      <View
        className="flex-row flex-wrap gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Token network"
      >
        {tokenNetworks.map(({ chainId, name }) => (
          <Choice
            key={chainId}
            label={name}
            selected={query.chainId === chainId}
            onPress={() => change({ chainId })}
          />
        ))}
      </View>
      <SearchInput
        label="Search tokens"
        value={query.search}
        maxLength={200}
        onChangeText={(search) => change({ search })}
      />
      <View
        className="flex-row gap-2"
        accessibilityRole="radiogroup"
        accessibilityLabel="Token category"
      >
        <Choice
          label="All"
          selected={query.category === "all"}
          onPress={() => change({ category: "all" })}
        />
        <Choice
          label="RWA"
          selected={query.category === "rwa"}
          onPress={() => change({ category: "rwa" })}
        />
      </View>
      {load.kind === "loading" && (
        <Typography accessibilityLiveRegion="polite">Loading tokens…</Typography>
      )}
      {load.kind === "failed" && (
        <View className="gap-3">
          <Typography accessibilityRole="alert">
            Token catalog unavailable. Please retry.
          </Typography>
          <Button label="Retry tokens" variant="secondary" onPress={retry} />
        </View>
      )}
      {load.kind === "ready" &&
        (load.data.list.length === 0 ? (
          <Typography>No tokens match your filters.</Typography>
        ) : (
          <View className="-mx-1.5 flex-row flex-wrap">
            {load.data.list.map((token) => (
              <View key={tokenIdentity(token)} className="w-1/2 px-1.5 pb-3">
                <TokenCard token={token} />
              </View>
            ))}
          </View>
        ))}
      <View className="flex-row items-center justify-between gap-3 pt-2">
        <PagerButton
          label="Prev"
          accessibilityLabel="Previous page"
          disabled={load.kind !== "ready" || query.page === 0}
          onPress={() => change({ page: query.page - 1 })}
        />
        <Typography variant="micro" accessibilityLabel={`Page ${query.page + 1}`}>
          {query.page + 1}
        </Typography>
        <PagerButton
          label="Next"
          accessibilityLabel="Next page"
          disabled={load.kind !== "ready" || (query.page + 1) * load.data.items >= load.data.total}
          onPress={() => change({ page: query.page + 1 })}
        />
      </View>
    </Screen>
  );
}
