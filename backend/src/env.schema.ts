import { z } from "zod";

const apiEnvSchema = z.object({
  NODE_ENV: z.enum(["local", "production", "test"]),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().min(1),
  MERKL_API_URL: z.string().min(1),
  MERKL_API_KEY: z.string().min(1),
  ONEINCH_API_KEY: z.string().min(1),
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
