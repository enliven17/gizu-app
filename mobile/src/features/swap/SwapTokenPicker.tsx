import { useState } from "react";
import { Modal, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Typography } from "@/components/atoms/Typography";
import { PressableScale } from "@/components/atoms/PressableScale";
import { InfiniteListScreen } from "@/components/templates/InfiniteListScreen";
import { Choice } from "@/components/molecules/Choice";
import { tokenIdentity, tokenNetworks, type CatalogToken } from "@/domain/tokenCatalog";
import { useTokenCatalog } from "./useTokenCatalog";
import type { ListedToken } from "./confidentialSwap";

export function SwapTokenPicker({
  tokens,
  target,
  disabled,
  onSelect,
}: {
  tokens: ListedToken[];
  target: string;
  disabled: boolean;
  onSelect: (token: CatalogToken) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = tokens.find((token) => token.address === target);
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Choose receive token"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setOpen(true);
        }}
        className="gap-3 rounded-[20px] bg-well p-4"
      >
        <Typography variant="label11">You receive</Typography>
        <View className="flex-row items-center justify-between gap-3">
          <Typography variant="rowTitle" className="flex-1 !text-[22px]">
            {selected?.symbol ?? "Choose token"}
          </Typography>
          <Typography variant="caption" className="rounded-full bg-neon/15 px-3 py-1 !text-neon">
            Change
          </Typography>
        </View>
        {selected && <Typography variant="micro">{selected.name}</Typography>}
      </PressableScale>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        {open && (
          <TokenChoices
            target={target}
            disabled={disabled}
            onClose={() => setOpen(false)}
            onSelect={(token) => {
              onSelect(token);
              setOpen(false);
            }}
          />
        )}
      </Modal>
    </>
  );
}

function TokenChoices({
  target,
  disabled,
  onClose,
  onSelect,
}: {
  target: string;
  disabled: boolean;
  onClose: () => void;
  onSelect: (token: CatalogToken) => void;
}) {
  const { query, queryKey, list, change } = useTokenCatalog("all");
  return (
    <InfiniteListScreen
      list={list}
      queryKey={queryKey}
      getIdentity={tokenIdentity}
      noun="tokens"
      unavailableMessage="Token catalog unavailable. Please retry."
      emptyMessage="No tokens found."
      header={
        <>
          <View className="flex-row items-center justify-between gap-3">
            <Typography variant="heading" accessibilityRole="header" className="flex-1">
              Choose token
            </Typography>
            <Button label="Close" variant="quiet" onPress={onClose} />
          </View>
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
          <Typography variant="micro">
            Browse all tokens. Swaps currently support Robinhood only; availability is checked
            during review.
          </Typography>
        </>
      }
      renderItem={(item) => {
        const selectable = item.chainId === 4663 && item.swapListed;
        const checked =
          item.chainId === 4663 && item.address.toLowerCase() === target.toLowerCase();
        return (
          <PressableScale
            accessibilityRole="radio"
            accessibilityLabel={`${item.symbol} · ${item.name}`}
            accessibilityState={{ checked, disabled: disabled || !selectable }}
            disabled={disabled || !selectable}
            onPress={() => {
              if (selectable && !disabled) onSelect(item);
            }}
            className={`mb-2 gap-1 rounded-2xl px-4 py-3 ${checked ? "bg-neon/10" : "bg-well"} ${!selectable ? "opacity-60" : ""}`}
          >
            <Typography variant="rowTitle" className={checked ? "!text-neon" : ""}>
              {item.symbol}
            </Typography>
            <Typography variant="micro">{item.name}</Typography>
            <Typography variant="micro">
              {tokenNetworks.find((network) => network.chainId === item.chainId)?.name}
              {!selectable ? " · Not available for swaps" : ""}
            </Typography>
          </PressableScale>
        );
      }}
    />
  );
}
