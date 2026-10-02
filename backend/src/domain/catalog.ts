import { z } from "zod";

const httpsUrl = z.url().refine((value) => value.startsWith("https://"));
export const catalogAddress = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/i)
  .refine((value) => !/^0x0{40}$/i.test(value));
export const catalogChainSchema = z.strictObject({
  id: z.number().int().positive().safe(),
  name: z.string().trim().min(1).max(80),
  explorerUrl: httpsUrl.optional(),
});
export const catalogVaultSchema = z.strictObject({
  chainId: z.number().int().positive().safe(),
  address: catalogAddress,
  name: z.string().trim().min(1).max(160).optional(),
  symbol: z.string().trim().min(1).max(40).optional(),
  description: z.string().trim().max(4000).optional(),
  depositUrl: httpsUrl.optional(),
  howToSteps: z.array(z.string().min(1).max(1000)).max(20).optional(),
  tags: z.array(z.string().min(1).max(80)).max(20).optional(),
  asset: z
    .strictObject({
      address: catalogAddress,
      name: z.string().min(1).max(160),
      symbol: z.string().min(1).max(40),
      decimals: z.number().int().min(0).max(36),
    })
    .optional(),
});
export type CatalogChain = z.infer<typeof catalogChainSchema>;
export type CatalogVault = z.infer<typeof catalogVaultSchema>;
// Preserve the historical catalog until operators explicitly configure its chains.
export const legacyCatalogChains: CatalogChain[] = [{ id: 143, name: "Monad" }];

export function jsonEnvironment<T extends z.ZodType>(schema: T) {
  return z
    .string()
    .max(65536)
    .transform((value, context) => {
      try {
        return JSON.parse(value) as unknown;
      } catch {
        context.addIssue({
          code: "custom",
          message: "must contain valid JSON",
        });
        return z.NEVER;
      }
    })
    .pipe(schema);
}
export const catalogChainsSchema = z
  .array(catalogChainSchema)
  .min(1)
  .max(64)
  .refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "chain IDs must be unique",
  );
export const catalogVaultsSchema = z
  .array(catalogVaultSchema)
  .max(64)
  .refine(
    (rows) =>
      new Set(rows.map((row) => `${row.chainId}:${row.address.toLowerCase()}`))
        .size === rows.length,
    "vault chain/address pairs must be unique",
  );
