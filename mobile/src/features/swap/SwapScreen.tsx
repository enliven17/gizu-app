import { View } from "react-native";
import { InfiniteListScreen } from "@/components/templates/InfiniteListScreen";
import { Typography } from "@/components/atoms/Typography";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Choice } from "@/components/molecules/Choice";
import { tokenIdentity, tokenNetworks } from "@/domain/tokenCatalog";
import { useTokenCatalog } from "./useTokenCatalog";
import { TokenCard } from "./components/TokenCard";
export function SwapScreen() {
  const { query, queryKey, list, change } = useTokenCatalog();
  return (
    <InfiniteListScreen
      list={list}
      queryKey={queryKey}
      getIdentity={tokenIdentity}
      renderItem={(token) => <TokenCard token={token} />}
      layout="grid"
      noun="tokens"
      unavailableMessage="Token catalog unavailable. Please retry."
      emptyMessage="No tokens match your filters."
      header={
        <>
          <Typography variant="pageTitle">Swap</Typography>
          <Typography variant="caption">
            Explore tokens. Quotes and swaps are not available yet. A 1inch listing does not
            establish Fusion availability.
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
        </>
      }
    />
  );
}
