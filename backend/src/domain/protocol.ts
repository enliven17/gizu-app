export const supportedProtocolIds = ["aave", "morpho", "curvance"] as const;

export type ProtocolId = (typeof supportedProtocolIds)[number];
export type ProtocolSelection = ProtocolId | "all";

const protocolNames: Record<ProtocolId, string> = {
  aave: "Aave",
  morpho: "Morpho",
  curvance: "Curvance",
};

export const supportedProtocols = supportedProtocolIds.map((id) => ({
  id,
  name: protocolNames[id],
}));
