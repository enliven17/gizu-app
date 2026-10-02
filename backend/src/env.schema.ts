import { z } from "zod";

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["local", "production", "test"]),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  MERKL_API_URL: z.string().min(1),
  MERKL_API_KEY: z.string().min(1),
  ONEINCH_API_KEY: z.string().min(1),
  AURORA_API_KEY: z.string().min(1),
  PIMLICO_API_KEY: z.string().min(1),
  ETHEREUM_RPC_URL: z
    .url()
    .refine((value) => value.startsWith("https://"))
    .optional(),
  ROBINHOOD_RPC_URL: z
    .url()
    .refine((value) => value.startsWith("https://"))
    .optional(),
  EARN_GATEWAY_RECOVERY_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  EARN_AURORA_HISTORY_QUALIFIED: z.enum(["true", "false"]).optional(),
  EARN_ANVIL_PATH: z.string().min(1).optional(),
  EARN_AURORA_FEE_QUALIFICATION_JSON: z.string().min(1).max(16384).optional(),
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function parseApiEnv(source: unknown): ApiEnv {
  const result = apiEnvSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const details = result.error.issues
    .map((issue) => {
      let key = "env";
      if (issue.path.length > 0) {
        key = issue.path.map(String).join(".");
      }
      return `${key}: ${issue.message}`;
    })
    .join("; ");
  throw new Error(`invalid env: ${details}`);
}
