import { View } from "react-native";
import { Skeleton } from "@/components/atoms/Skeleton";

/** Placeholder matching the vault card: chip, sparkline band, name and footer. */
function VaultCardSkeleton() {
  return (
    <View className="w-full xs:w-[48%]">
      <View className="gap-3 rounded-card border border-cardEdge bg-card p-4">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-4 w-3/4" />
        <View className="flex-row justify-between">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-1/5" />
        </View>
      </View>
    </View>
  );
}

/** Grid of card placeholders, announced once as a single loading status. */
export function CardGridSkeleton({ count = 4, label }: { count?: number; label: string }) {
  return (
    <View
      accessible
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
      className="flex-row flex-wrap justify-between gap-y-3"
    >
      {Array.from({ length: count }, (_, index) => (
        <VaultCardSkeleton key={index} />
      ))}
    </View>
  );
}

/** Stacked row placeholders for single-column lists. */
export function RowListSkeleton({ count = 5, label }: { count?: number; label: string }) {
  return (
    <View accessible accessibilityLabel={label} accessibilityLiveRegion="polite" className="gap-2">
      {Array.from({ length: count }, (_, index) => (
        <View key={index} className="flex-row items-center gap-3 rounded-2xl bg-well p-4">
          <Skeleton className="h-9 w-9 rounded-full" />
          <View className="flex-1 gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </View>
          <Skeleton className="h-4 w-14" />
        </View>
      ))}
    </View>
  );
}
