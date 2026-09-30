import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { DomainError } from "../domain/errors/domain-error.ts";
import { InfrastructureError } from "../domain/errors/infrastructure-error.ts";

export function mapRequestError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Provider errors can contain signed payloads, bearer tokens or keyed URLs in
  // their message/cause. Swap diagnostics use the application code only.
  const logError = () => {
    if (request.routeOptions.url?.startsWith("/v1/swap/")) {
      const code = error instanceof InfrastructureError || error instanceof DomainError
        ? error.code
        : error instanceof ZodError || error.validation ? "VALIDATION_ERROR" : "INTERNAL_ERROR";
      request.log.error({ event: "swap.error", code, route: request.routeOptions.url }, "swap request failed");
    } else request.log.error(error);
  };
  if (error instanceof DomainError) {
    return reply.code(400).send({ code: error.code, message: error.message });
  }
  if (error instanceof InfrastructureError) {
    logError();
    return reply
      .code(error.statusCode)
      .send({ code: error.code, message: error.message });
  }
  if (error instanceof ZodError || error.validation) {
    logError();
    return reply
      .code(400)
      .send({ code: "VALIDATION_ERROR", message: "invalid request" });
  }
  logError();
  return reply
    .code(500)
    .send({ code: "INTERNAL_ERROR", message: "unexpected error" });
}
