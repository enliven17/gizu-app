import { protocolLogo } from "@/features/opportunities/protocolLogos";
import morpho from "../../assets/logos/morpho.png";
test("the stable Morpho protocol ID keeps the logo when a vault uses a different display name", () => {
  expect(protocolLogo("Gizu Prime AUSD", "morpho")).toBe(morpho);
  expect(protocolLogo("Morpho V2")).toBe(morpho);
  expect(protocolLogo("Unknown protocol")).toBeUndefined();
});
