import { Pressable, View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import { Badge } from "@/components/atoms/Badge";
import { Sparkline } from "@/components/molecules/Sparkline";
import type { Vault } from "@/domain/investments";
export function VaultList({ vaults, onOpen }: { vaults: Vault[]; onOpen: (id: string) => void }) {
  return (
    <View className="flex-row flex-wrap justify-between gap-y-3">
      {vaults.map((vault) => (
        <Pressable
          key={vault.id}
          accessibilityRole="button"
          accessibilityLabel={`View ${vault.name}`}
          accessibilityHint={`${vault.risk} risk, APY ${vault.apy} percent, TVL ${vault.tvl}`}
          onPress={() => onOpen(vault.id)}
          className="w-full gap-4 rounded-3xl border border-border bg-surface p-4 active:opacity-70 xs:w-[48%]"
        >
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <View className="rounded-xl bg-accent/10 p-3">
              <Typography variant="label">{vault.ticker}</Typography>
            </View>
            <Badge
              label={`${Number(vault.change24h) >= 0 && !vault.change24h.startsWith("+") ? "+" : ""}${vault.change24h}%`}
              negative={Number(vault.change24h) < 0}
            />
          </View>
          <View className="py-2">
            <Sparkline series={vault.series} negative={Number(vault.change24h) < 0} height={56} />
          </View>
          <Typography variant="row">{vault.name}</Typography>
          <View className="flex-row flex-wrap justify-between gap-2">
            <Typography variant="caption">{vault.tvl} TVL</Typography>
            <Typography variant="label">{vault.apy}% APY</Typography>
          </View>
        </Pressable>
      ))}
    </View>
  );
}
