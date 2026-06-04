// apps/agent-api/src/routes/healthRoutes.ts

import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { config } from "../config.js";
import { checkAgentDbReady } from "../db/dbBootstrap.js";

export const healthRoutes: FastifyPluginAsync = async (app: FastifyInstance) => {
  app.get("/healthz", async (_req, reply) => {
    return reply.send({
      ok: true,
      service: "vera-anchor-discovery-agent",
      version: "0.1.0",
    });
  });

  app.get("/readyz", async (_req, reply) => {
    try {
      const db = await checkAgentDbReady();

      return reply.send({
        ready: true,
        service: "vera-anchor-discovery-agent",
        network: config.hederaNetwork,
        demo_payment_mode: config.demoPaymentMode,
        db,
      });
    } catch (err) {
      return reply.code(503).send({
        ready: false,
        service: "vera-anchor-discovery-agent",
        network: config.hederaNetwork,
        error: err instanceof Error ? err.message : "readiness_check_failed",
      });
    }
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