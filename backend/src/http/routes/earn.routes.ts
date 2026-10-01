import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "@fastify/type-provider-zod";
import { z } from "zod";
import type { EarnPreflight } from "../../adapters/evm/earn-preflight.ts";
import type { ConfidentialBalance } from "../../adapters/aurora/confidential-balance.ts";
const authenticationBody = z.object({signedData:z.object({standard:z.literal("erc191"),payload:z.string().min(1).max(2048),signature:z.string().min(1).max(128)}).strict()}).strict();
const body = z.object({ profileId: z.enum(["ethereum-usdc", "robinhood-usdg"]), owner: z.string().regex(/^0x[0-9a-f]{40}$/i) }).strict();
export function registerEarnRoutes(app: FastifyInstance, preflight: Pick<EarnPreflight, "check">, privateBalance?: Pick<ConfidentialBalance, "read">) {
  app.withTypeProvider<ZodTypeProvider>().post("/v1/earn/preflight", { schema: { body }, bodyLimit: 1024 }, async (request, reply) => reply.send(await preflight.check(request.body.profileId, request.body.owner)));
  if (privateBalance) app.withTypeProvider<ZodTypeProvider>().post("/v1/earn/private-balance", {schema:{body:authenticationBody},bodyLimit:4096},async(request,reply)=>reply.header("Cache-Control","no-store").send(await privateBalance.read(request.body.signedData)));
}
