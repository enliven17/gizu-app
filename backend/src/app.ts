import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import { AuroraIntents } from "./adapters/aurora/aurora-intents.ts";
import { diagnosticAuroraFetch } from "./adapters/aurora/diagnostics.ts";
import { OneInchFusion } from "./adapters/oneinch/fusion.ts";
import { OneInchTokenCatalog } from "./adapters/oneinch/token-catalog.ts";
import { PimlicoMonadFunding } from "./adapters/pimlico/monad-funding.ts";
import { registerSwapRoutes } from "./http/routes/swap.routes.ts";
import { registerTokenRoutes } from "./http/routes/tokens.routes.ts";
import { HttpMerklOpportunities } from "./adapters/merkl/http-merkl-opportunities.ts";
import { PgCache } from "./adapters/postgres/pg-cache.ts";
import { PgDatabaseProbe } from "./adapters/postgres/pg-database-probe.ts";
import { createPgPool } from "./adapters/postgres/pg-pool.ts";
import type { ApiEnv } from "./env.schema.ts";
import { HealthController } from "./http/controllers/health.controller.ts";
import { OpportunitiesController } from "./http/controllers/opportunities.controller.ts";
import { mapRequestError } from "./http/map-request-error.ts";
import { registerHealthRoutes } from "./http/routes/health.routes.ts";
import { registerOpportunityRoutes } from "./http/routes/opportunities.routes.ts";
import { PurgeExpiredCacheUseCase } from "./usecase/cache/purge-expired-cache.usecase.ts";
import { CheckDatabaseHealthUseCase } from "./usecase/health/check-database-health.usecase.ts";
import { GetOpportunityTvlRecordsUseCase } from "./usecase/opportunities/get-opportunity-tvl-records.usecase.ts";
import { GetOpportunityUseCase } from "./usecase/opportunities/get-opportunity.usecase.ts";
import { ListOpportunitiesUseCase } from "./usecase/opportunities/list-opportunities.usecase.ts";

const CACHE_PURGE_INTERVAL_MS = 5 * 60 * 1000;

export async function buildApp(secret: ApiEnv): Promise<FastifyInstance> {
  let loggerOptions: FastifyServerOptions["logger"] = {
    level: "info",
  };
  if (secret.NODE_ENV === "local") {
    loggerOptions = {
      level: "info",
      transport: { target: "pino-pretty" },
    };
  }
  if (secret.NODE_ENV === "test") {
    loggerOptions = false;
  }

  const app = Fastify({
    logger: loggerOptions,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  const pgPool = createPgPool(secret.DATABASE_URL);
  const healthController = new HealthController(
    new CheckDatabaseHealthUseCase(new PgDatabaseProbe(pgPool)),
  );

  registerHealthRoutes(app, healthController);
  registerTokenRoutes(app, new OneInchTokenCatalog(secret.ONEINCH_API_KEY));
  registerSwapRoutes(app, {
    aurora: new AuroraIntents(secret.AURORA_API_KEY, diagnosticAuroraFetch((event) => app.log.info(event, "swap provider request"))),
    funding: new PimlicoMonadFunding(secret.PIMLICO_API_KEY),
    fusion: new OneInchFusion(secret.ONEINCH_API_KEY),
  });
  const opportunities = new HttpMerklOpportunities(
    secret.MERKL_API_URL,
    secret.MERKL_API_KEY,
  );
  const cache = new PgCache(pgPool);
  registerOpportunityRoutes(
    app,
    new OpportunitiesController(
      new ListOpportunitiesUseCase(opportunities, cache),
      new GetOpportunityUseCase(opportunities, cache),
      new GetOpportunityTvlRecordsUseCase(opportunities, cache),
    ),
  );
  app.setErrorHandler(mapRequestError);

  const purgeExpiredCache = new PurgeExpiredCacheUseCase(cache);
  const purgeTimer = setInterval(() => {
    void purgeExpiredCache
      .execute()
      .then((deleted) => {
        if (deleted > 0) {
          app.log.info({ deleted }, "purged expired cache rows");
        }
      })
      .catch((err: unknown) => {
        app.log.error(err, "cache purge failed");
      });
  }, CACHE_PURGE_INTERVAL_MS);
  purgeTimer.unref();

  app.addHook("onClose", async () => {
    clearInterval(purgeTimer);
    await pgPool.end();
  });

  return app;
}
