import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { config } from "../config.js";

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/healthz", async (_req, reply) => {
    return reply.send({
      ok: true,
      service: "vera-anchor-discovery-agent",
      version: "0.1.0",
    });
  });

  app.get("/readyz", async (_req, reply) => {
    return reply.send({
      ready: true,
      service: "vera-anchor-discovery-agent",
      network: config.hederaNetwork,
      demo_payment_mode: config.demoPaymentMode,
    });
  });

  app.get("/v1/health", async (_req, reply) => {
    return reply.send({
      ok: true,
      service: "vera-anchor-discovery-agent",
      version: "0.1.0",
      network: config.hederaNetwork,
    });
  });
};