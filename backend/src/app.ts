import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";
import { createHash } from "node:crypto";
import { legacyCatalogChains } from "./domain/catalog.ts";
import { ConfiguredOpportunities } from "./adapters/catalog/configured-opportunities.ts";
import { MorphoVaults } from "./adapters/catalog/morpho-vaults.ts";
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
import { ConfidentialBalance } from "./adapters/aurora/confidential-balance.ts";
import { EarnPreflight } from "./adapters/evm/earn-preflight.ts";
import { registerEarnRoutes } from "./http/routes/earn.routes.ts";
import { registerEarnPlanningRoutes } from "./http/routes/earn-planning.routes.ts";
import { EthereumDepositPlanner } from "./adapters/earn/ethereum-deposit-planner.ts";
import { MonadFundingPlanner } from "./adapters/pimlico/source-funding.ts";
import { EthereumWithdrawalPlanner } from "./adapters/earn/ethereum-withdrawal-planner.ts";
import { RobinhoodDepositPlanner } from "./adapters/earn/robinhood-deposit-planner.ts";
import { ConfidentialSettlement } from "./adapters/aurora/settlement.ts";
import { registerEarnSettlementRoutes } from "./http/routes/earn-settlement.routes.ts";
import { NativeEarnGateway,parseAuroraFeeQualification } from "./adapters/earn/native-gateway.ts";
import { registerEarnNativeRoutes } from "./http/routes/earn-native.routes.ts";
import { FusionNativeGateway } from "./adapters/earn/fusion-native.ts";
import { registerEarnFusionRoutes } from "./http/routes/earn-fusion.routes.ts";
import { PrivatePayoutGateway } from "./adapters/earn/private-payout.ts";
import {RobinhoodWithdrawalPlanner,RobinhoodReturnPlanner} from "./adapters/earn/robinhood-exit-planner.ts";
import { EthereumReturnPlanner } from "./adapters/earn/ethereum-return-planner.ts";
import { registerEarnReturnRoutes } from "./http/routes/earn-return.routes.ts";
import { EarnExitSnapshot } from "./adapters/earn/exit-snapshot.ts";
import { registerEarnExitRoutes } from "./http/routes/earn-exit.routes.ts";
import { registerEarnPayoutRoutes } from "./http/routes/earn-payout.routes.ts";
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
  registerEarnRoutes(app, new EarnPreflight(), new ConfidentialBalance(secret.AURORA_API_KEY));
  const ethereumPlannerConfig={rpcUrl:secret.ETHEREUM_RPC_URL??"https://ethereum-rpc.publicnode.com",oneInchApiKey:secret.ONEINCH_API_KEY,anvilPath:secret.EARN_ANVIL_PATH};
  registerEarnSettlementRoutes(app,new ConfidentialSettlement(secret.AURORA_API_KEY));
  const nativeGateway=new NativeEarnGateway({auroraHistoryQualified:secret.EARN_AURORA_HISTORY_QUALIFIED==="true",recoveryKey:secret.EARN_GATEWAY_RECOVERY_KEY,pimlicoApiKey:secret.PIMLICO_API_KEY,auroraApiKey:secret.AURORA_API_KEY,auroraFeeQualification:secret.EARN_AURORA_FEE_QUALIFICATION_JSON?parseAuroraFeeQualification(secret.EARN_AURORA_FEE_QUALIFICATION_JSON):undefined});
  const hoodConfig={rpcUrl:secret.ROBINHOOD_RPC_URL??"https://rpc.mainnet.chain.robinhood.com",pimlicoApiKey:secret.PIMLICO_API_KEY,anvilPath:secret.EARN_ANVIL_PATH,auroraApiKey:secret.AURORA_API_KEY};
  registerEarnPlanningRoutes(app,new EthereumDepositPlanner(ethereumPlannerConfig),new MonadFundingPlanner(secret.PIMLICO_API_KEY),new EthereumWithdrawalPlanner(ethereumPlannerConfig),new RobinhoodDepositPlanner(hoodConfig),new RobinhoodWithdrawalPlanner(hoodConfig),new RobinhoodReturnPlanner(hoodConfig,nativeGateway));
  registerEarnNativeRoutes(app,nativeGateway);
  registerEarnReturnRoutes(app,new EthereumReturnPlanner(ethereumPlannerConfig,{quote:r=>nativeGateway.returnQuote(r)}));
  registerEarnFusionRoutes(app,new FusionNativeGateway({recoveryKey:secret.EARN_GATEWAY_RECOVERY_KEY,apiKey:secret.ONEINCH_API_KEY,rpcUrl:ethereumPlannerConfig.rpcUrl}));
  registerEarnExitRoutes(app, new EarnExitSnapshot({ethereumRpcUrl:ethereumPlannerConfig.rpcUrl,robinhoodRpcUrl:secret.ROBINHOOD_RPC_URL,auroraApiKey:secret.AURORA_API_KEY}));
  registerEarnPayoutRoutes(app,new PrivatePayoutGateway({recoveryKey:secret.EARN_GATEWAY_RECOVERY_KEY,auroraApiKey:secret.AURORA_API_KEY,auroraFeeQualification:secret.EARN_AURORA_FEE_QUALIFICATION_JSON?parseAuroraFeeQualification(secret.EARN_AURORA_FEE_QUALIFICATION_JSON):undefined,ethereumRpcUrl:ethereumPlannerConfig.rpcUrl,robinhoodRpcUrl:secret.ROBINHOOD_RPC_URL??"https://rpc.mainnet.chain.robinhood.com"}));
  const chains = secret.CATALOG_CHAINS_JSON ?? legacyCatalogChains;
  const vaults = secret.CATALOG_VAULTS_JSON ?? [];
  const namespace = `catalog:v1:${createHash("sha256")
    .update(JSON.stringify({ chains, vaults, morpho: secret.MORPHO_API_URL, merkl: secret.MERKL_API_URL }))
    .digest("hex")}`;
  const opportunities = new ConfiguredOpportunities(
    chains,
    vaults,
    new HttpMerklOpportunities(secret.MERKL_API_URL, secret.MERKL_API_KEY),
    new MorphoVaults(secret.MORPHO_API_URL),
  );
  const cache = new PgCache(pgPool);
  registerOpportunityRoutes(
    app,
    new OpportunitiesController(
      new ListOpportunitiesUseCase(opportunities, cache, namespace),
      new GetOpportunityUseCase(opportunities, cache, namespace),
      new GetOpportunityTvlRecordsUseCase(opportunities, cache, namespace),
    ),
    chains,
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
