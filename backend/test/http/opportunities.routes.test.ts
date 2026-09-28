import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "@fastify/type-provider-zod";
import { OpportunitiesController } from "../../src/http/controllers/opportunities.controller.ts";
import { mapRequestError } from "../../src/http/map-request-error.ts";
import { registerOpportunityRoutes } from "../../src/http/routes/opportunities.routes.ts";
import type { Cache } from "../../src/ports/cache.port.ts";
import type { ListOpportunitiesQuery } from "../../src/ports/opportunities.port.ts";
import { GetOpportunityTvlRecordsUseCase } from "../../src/usecase/opportunities/get-opportunity-tvl-records.usecase.ts";
import { GetOpportunityUseCase } from "../../src/usecase/opportunities/get-opportunity.usecase.ts";
import { ListOpportunitiesUseCase } from "../../src/usecase/opportunities/list-opportunities.usecase.ts";

test("lists the three protocols and scopes each opportunity request", async () => {
  const queries: ListOpportunitiesQuery[] = [];
  const cache: Cache = {
    get: async () => null,
    set: async () => {},
    deleteExpired: async () => 0,
  };
  const opportunities = {
    list: async (query: ListOpportunitiesQuery) => {
      queries.push(query);
      return { list: [], total: 0 };
    },
    getById: async () => {
      throw new Error("unused");
    },
    tvlRecords: async () => [],
  };
  const app = Fastify({ logger: false }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.setErrorHandler(mapRequestError);
  registerOpportunityRoutes(
    app,
    new OpportunitiesController(
      new ListOpportunitiesUseCase(opportunities, cache),
      new GetOpportunityUseCase(opportunities, cache),
      new GetOpportunityTvlRecordsUseCase(opportunities, cache),
    ),
  );

  const catalog = await app.inject({ method: "GET", url: "/v1/protocols" });
  assert.equal(catalog.statusCode, 200);
  assert.deepEqual(catalog.json(), {
    list: [
      { id: "aave", name: "Aave" },
      { id: "morpho", name: "Morpho" },
      { id: "curvance", name: "Curvance" },
    ],
  });

  for (const protocolId of ["aave", "morpho", "curvance"]) {
    const response = await app.inject({
      method: "GET",
      url: `/v1/protocols/${protocolId}/opportunities?search=&page=0&items=20&chainId=143`,
    });
    assert.equal(response.statusCode, 200);
  }
  assert.deepEqual(
    queries.map((query) => query.protocol),
    ["aave", "morpho", "curvance"],
  );

  const unsupported = await app.inject({
    method: "GET",
    url: "/v1/protocols/euler/opportunities?search=&page=0&items=20&chainId=143",
  });
  assert.equal(unsupported.statusCode, 400);
  assert.deepEqual(unsupported.json(), {
    code: "VALIDATION_ERROR",
    message: "invalid request",
  });

  const oversizedPage = await app.inject({
    method: "GET",
    url: "/v1/protocols/aave/opportunities?search=&page=0&items=101&chainId=143",
  });
  assert.equal(oversizedPage.statusCode, 400);
  assert.equal(queries.length, 3);
  await app.close();
});
