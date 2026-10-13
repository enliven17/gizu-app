import type { Pool } from "pg";
import type { EarlyAccess, EarlyAccessSignup } from "../../ports/early-access.port.ts";

export class PgEarlyAccess implements EarlyAccess {
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly pool: Pick<Pool, "query">) {}

  async add({ email, ...preferences }: EarlyAccessSignup): Promise<void> {
    await this.ensureSchema();
    await this.pool.query(
      `insert into early_access_signups (email, preferences)
       values ($1, $2::jsonb)
       on conflict (email) do update
       set preferences = early_access_signups.preferences || excluded.preferences`,
      [email.trim().toLowerCase(), JSON.stringify(preferences)],
    );
  }

  private ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool.query(`
        create table if not exists early_access_signups (
          email text primary key,
          preferences jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )
      `).then(() => {}).catch((error: unknown) => {
        this.schemaReady = undefined;
        throw error;
      });
    }
    return this.schemaReady;
  }
}
