import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import type { CatalogToken } from "../../adapters/oneinch/token-catalog.ts";

const querySchema = z.object({
  chainId: z.coerce.number().int().refine((id) => [1, 143, 4663].includes(id)),
  category: z.enum(["all", "rwa"]),
  search: z.string().max(200),
  page: z.coerce.number().int().nonnegative(),
  items: z.coerce.number().int().min(1).max(100),
});

export function registerTokenRoutes(
  app: FastifyInstance,
  catalog: { list(chainId: number, category: "all" | "rwa"): Promise<CatalogToken[]> },
) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/v1/tokens",
    { schema: { querystring: querySchema } },
    async (request, reply) => {
      const tokens = await catalog.list(request.query.chainId, request.query.category);
      const search = request.query.search.trim().toLowerCase();
      const matches = tokens.filter((token) =>
        token.symbol.toLowerCase().includes(search) ||
        token.name.toLowerCase().includes(search) ||
        token.address.toLowerCase().includes(search) ||
        (token.issuer !== null && token.issuer.toLowerCase().includes(search)),
      );
      const { page, items } = request.query;
      const list = matches.slice(page * items, (page + 1) * items);
      return reply.code(200).send({ list, page, items, total: matches.length });
    },
  );
}
