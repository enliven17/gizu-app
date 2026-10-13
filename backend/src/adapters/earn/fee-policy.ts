import { z } from "zod";
export const auroraRoutes = [
  "source",
  "payoutEthereum",
  "payoutRobinhood",
  "returnUsdc",
  "returnEth",
  "returnRobinhood",
  "withdrawal",
] as const;
export type AuroraRoute = (typeof auroraRoutes)[number];
const identity = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_.:-]+$/);
const bps = z.number().int().min(0).max(100);
// Existing deployed configurations remain exact, two-bps/no-referral policies.
const legacy = z
  .object({
    protocolFeeBps: z.literal(2),
    appFees: z
      .array(z.object({ recipient: identity, fee: z.literal(2) }).strict())
      .length(1),
    referral: z.null(),
  })
  .strict();
const rule = z
  .object({
    collectors: z
      .array(z.object({ recipient: identity, maximumBps: bps }).strict())
      .min(1)
      .max(8),
    maximumTotalBps: bps,
    referral: z.union([identity, z.array(identity).min(1).max(8)]).nullable(),
    integratorFeeBps: z.literal(0),
    applicationFeeAtoms: z.literal("0"),
    // Evidence for the configured integrator charge and observed service-fee limits.
    // A quote does not establish the ultimate beneficiary of a service collector.
    qualificationReference: identity,
  })
  .strict()
  .refine(
    (r) =>
      new Set(r.collectors.map((c) => c.recipient)).size ===
      r.collectors.length,
  );
const registry = z
  .object({
    version: identity,
    routes: z.partialRecord(z.enum(auroraRoutes), rule),
  })
  .strict();
const schema = z.union([legacy, registry]);
export type AuroraFeeQualification = z.infer<typeof schema>;
export const auroraFeeProofSchema = z
  .object({
    version: identity,
    route: z.enum(auroraRoutes),
    totalBps: bps,
    appFees: z
      .array(z.object({ recipient: identity, fee: bps }).strict())
      .max(8),
    referral: identity.nullable(),
    integratorFeeBps: z.literal(0),
    applicationFeeAtoms: z.literal("0"),
  })
  .strict()
  .refine(
    (p) =>
      p.appFees.reduce((sum, f) => sum + f.fee, 0) === p.totalBps &&
      new Set(p.appFees.map((f) => f.recipient)).size === p.appFees.length,
  );
export type AuroraFeeProof = z.infer<typeof auroraFeeProofSchema>;
export function parseAuroraFeeQualification(
  value: string,
): AuroraFeeQualification {
  return schema.parse(JSON.parse(value));
}
export function qualifyAuroraFees(
  policy: AuroraFeeQualification | undefined,
  route: string,
  value: unknown,
): AuroraFeeProof {
  const q = z
    .object({
      appFees: z
        .array(z.object({ recipient: identity, fee: bps }).strict())
        .max(8)
        .default([]),
      referral: identity.nullish(),
    })
    .parse(value);
  if (!policy || !auroraRoutes.includes(route as AuroraRoute))
    throw new Error("Unqualified route");
  const fees = q.appFees
    .slice()
    .sort((a, b) => a.recipient.localeCompare(b.recipient));
  if (new Set(fees.map((f) => f.recipient)).size !== fees.length)
    throw new Error("Duplicate collectors");
  const totalBps = fees.reduce((sum, f) => sum + f.fee, 0);
  if ("protocolFeeBps" in policy) {
    if (
      JSON.stringify(fees) !== JSON.stringify(policy.appFees) ||
      (q.referral ?? null) !== null
    )
      throw new Error("Unqualified fees");
  } else {
    const r = policy.routes[route as AuroraRoute];
    if (
      !r ||
      totalBps > r.maximumTotalBps ||
      !(Array.isArray(r.referral)
        ? r.referral.includes(q.referral ?? "")
        : (q.referral ?? null) === r.referral) ||
      fees.some(
        (f) =>
          !r.collectors.some(
            (c) => c.recipient === f.recipient && f.fee <= c.maximumBps,
          ),
      )
    )
      throw new Error("Unqualified fees");
  }
  return Object.freeze({
    version: "version" in policy ? policy.version : "legacy-exact-2bps",
    route: route as AuroraRoute,
    totalBps,
    appFees: fees,
    referral: q.referral ?? null,
    integratorFeeBps: 0,
    applicationFeeAtoms: "0",
  });
}

/** Inspected Gizu portal: zero integrator fee, no collection address/custom rules,
 * confidential settings inherit public settings. These are observed Aurora service
 * charges, not a claim about collector ownership. Explicit env policies override it. */
export const observedAuroraFeeQualification = parseAuroraFeeQualification(
  JSON.stringify({
    version: "gizu-portal-zero-2026-10-12",
    routes: Object.fromEntries(
      [
        ["source", 4, false],
        ["withdrawal", 4, false],
        ["payoutRobinhood", 45, true],
        ["returnRobinhood", 45, true],
      ].map(([route, maximumTotalBps, hood]) => [
        route,
        {
          collectors: [
            {
              recipient: "widget_collect.sputnik-dao.near",
              maximumBps: hood ? 25 : 4,
            },
            ...(hood
              ? [
                  {
                    recipient:
                      "2238fd089f1c92b206c218cd16b8676cb98964e0d50f8ab729c6396a81e07805",
                    maximumBps: 20,
                  },
                ]
              : []),
          ],
          maximumTotalBps,
          referral: ["aurora-jh500bnyo9", "aurora-1u3j2qzclc"],
          integratorFeeBps: 0,
          applicationFeeAtoms: "0",
          qualificationReference: "portal-059a-zero-and-quotes-2026-10-12",
        },
      ]),
    ),
  }),
);

/** Require configured policies for the chosen profile's entire lifecycle before source funding. */
export function hasAuroraProfileQualification(
  policy: AuroraFeeQualification | undefined,
  profileChainId: 1 | 4663,
): boolean {
  if (!policy) return false;
  if ("protocolFeeBps" in policy) return true;
  const required: AuroraRoute[] =
    profileChainId === 1
      ? ["source", "payoutEthereum", "returnUsdc", "returnEth", "withdrawal"]
      : ["source", "payoutRobinhood", "returnRobinhood", "withdrawal"];
  return required.every((route) => policy.routes[route] !== undefined);
}
