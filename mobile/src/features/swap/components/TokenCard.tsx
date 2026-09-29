import { useState } from "react";
import { Image, View } from "react-native";
import { Typography } from "@/components/atoms/Typography";
import type { CatalogToken } from "@/domain/tokenCatalog";
function TokenLogo({ token }: { token: CatalogToken }) {
  const [failed, setFailed] = useState(false);
  return token.logoURI && /^https?:\/\//i.test(token.logoURI) && !failed ? (
    <Image
      source={{ uri: token.logoURI }}
      accessibilityLabel={`${token.symbol} logo`}
      className="h-11 w-11 rounded-full"
      onError={() => setFailed(true)}
    />
  ) : (
    <View
      accessibilityLabel={`${token.symbol} logo unavailable`}
      className="h-11 w-11 items-center justify-center rounded-full bg-neon/10"
    >
      <Typography variant="label">{token.symbol.slice(0, 2).toUpperCase() || "?"}</Typography>
    </View>
  );
}
export function TokenCard({ token }: { token: CatalogToken }) {
  return (
    <View className="flex-1 gap-3 rounded-2xl border border-borderSoft bg-glassSoft p-4">
      <View className="items-start gap-3">
        <TokenLogo key={token.logoURI} token={token} />
        <View className="w-full gap-1">
          <Typography variant="rowTitle">{token.symbol}</Typography>
          <Typography variant="caption">{token.name}</Typography>
        </View>
      </View>
      {token.issuer !== null && <Typography variant="caption">Issuer: {token.issuer}</Typography>}
      <View className="gap-2">
        <Typography variant="eyebrow">
          {token.category === "rwa" ? "RWA" : "Other asset"}
        </Typography>
        <Typography variant="eyebrow">
          {token.swapListed ? "Listed on 1inch" : "Not listed on 1inch"}
        </Typography>
      </View>
    </View>
  );
}
