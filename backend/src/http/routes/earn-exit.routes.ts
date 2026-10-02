import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import type { EarnExitSnapshot } from "../../adapters/earn/exit-snapshot.ts";
export function registerEarnExitRoutes(
  app: FastifyInstance,
  snapshot: Pick<EarnExitSnapshot, "read">,
) {
  app.withTypeProvider<ZodTypeProvider>().post(
    "/v1/earn/exit-snapshot",
    {
      bodyLimit: 512,
      schema: {
        body: z
          .object({
            profileId: z.enum(["ethereum-usdc", "robinhood-usdg"]),
            owner: z.string().regex(/^0x[0-9a-f]{40}$/i),
          })
          .strict(),
      },
    },
    async (request, reply) =>
      reply
        .header("Cache-Control", "no-store")
        .send(await snapshot.read(request.body)),
  );
}
