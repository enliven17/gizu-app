import { config } from "dotenv";
import { join } from "node:path";

export function resolveEnv(directory: string = process.cwd()): NodeJS.ProcessEnv {
  const loaded = config({ path: join(directory, ".env"), quiet: true });
  const error = loaded.error as NodeJS.ErrnoException | undefined;
  if (error !== undefined && error.code !== "ENOENT") {
    throw loaded.error;
  }
  return process.env;
}
