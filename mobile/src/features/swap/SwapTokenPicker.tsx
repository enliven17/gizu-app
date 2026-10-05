import { useState } from "react";
import { FlatList, Modal, View } from "react-native";
import { Button } from "@/components/atoms/Button";
import { SearchInput } from "@/components/atoms/SearchInput";
import { Typography } from "@/components/atoms/Typography";
import { PressableScale } from "@/components/atoms/PressableScale";
import { ScreenFrame } from "@/components/templates/ScreenFrame";
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
  onSelect: (address: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = tokens.find((token) => token.address === target);
  const query = search.trim().toLowerCase();
  const matches = tokens.filter((token) =>
    `${token.symbol} ${token.name}`.toLowerCase().includes(query),
  );
  return (
    <>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Choose receive token"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setSearch("");
          setOpen(true);
        }}
        className="gap-2 rounded-[28px] border border-glassBorder bg-glass p-6"
      >
        <Typography variant="micro">You receive</Typography>
        <View className="flex-row items-center justify-between gap-3">
          <Typography variant="rowTitle" className="flex-1">
            {selected?.symbol ?? "Choose token"}
          </Typography>
          <Typography variant="caption" className="!text-neon">
            Change
          </Typography>
        </View>
        {selected && <Typography variant="micro">{selected.name}</Typography>}
      </PressableScale>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <ScreenFrame>
          <View className="flex-1 gap-4 px-5 py-4">
            <View className="flex-row items-center justify-between gap-3">
              <Typography variant="heading" accessibilityRole="header" className="flex-1">
                Choose token
              </Typography>
              <Button label="Close" variant="quiet" onPress={() => setOpen(false)} />
            </View>
            <SearchInput label="Search tokens" value={search} onChangeText={setSearch} />
            <FlatList
              data={matches}
              keyExtractor={(token) => token.address}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              ListEmptyComponent={<Typography variant="caption">No tokens found.</Typography>}
              renderItem={({ item }) => (
                <PressableScale
                  accessibilityRole="radio"
                  accessibilityLabel={`${item.symbol} · ${item.name}`}
                  accessibilityState={{ checked: item.address === target, disabled }}
                  disabled={disabled}
                  onPress={() => {
                    onSelect(item.address);
                    setOpen(false);
                  }}
                  className="gap-1 border-b border-borderSoft py-4"
                >
                  <Typography
                    variant="rowTitle"
                    className={item.address === target ? "!text-neon" : ""}
                  >
                    {item.symbol}
                  </Typography>
                  <Typography variant="micro">{item.name}</Typography>
                </PressableScale>
              )}
            />
          </View>
        </ScreenFrame>
      </Modal>
    </>
  );
}
