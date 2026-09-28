import type { ImageSourcePropType } from "react-native";
import aave from "../../../assets/logos/aave.png";
import curvance from "../../../assets/logos/curvance.png";
import morpho from "../../../assets/logos/morpho.png";

// White marks derived from DefiLlama protocol icons (Curvance redrawn from its favicon)
// so they sit on the dark UI like the rest of the monochrome iconography.
const logos: Record<string, ImageSourcePropType> = { aave, morpho, curvance };

/** Logo for a catalog protocol name, or undefined to fall back to the text chip. */
export function protocolLogo(name: string): ImageSourcePropType | undefined {
  return logos[name.trim().toLowerCase().split(/\s+/)[0] ?? ""];
}
