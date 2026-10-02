import type { ImageSourcePropType } from "react-native";
import aave from "../../../assets/logos/aave.png";
import curvance from "../../../assets/logos/curvance.png";
import morpho from "../../../assets/logos/morpho.png";

// White marks derived from DefiLlama protocol icons (Curvance redrawn from its favicon)
// so they sit on the dark UI like the rest of the monochrome iconography.
const logos: Record<string, ImageSourcePropType> = { aave, morpho, curvance };

/** Stable provider ID takes precedence; older adapters can still use display names. */
export function protocolLogo(name: string, id?: string): ImageSourcePropType | undefined {
  return (
    logos[id?.trim().toLowerCase() ?? ""] ?? logos[name.trim().toLowerCase().split(/\s+/)[0] ?? ""]
  );
}
