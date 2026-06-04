// apps/agent-api/src/routes/routeContext.ts

import type { FastifyRequest } from "fastify";
import type { AgentServiceContext } from "../services/agentServiceContext.js";

export function buildAgentServiceContext(req: FastifyRequest): AgentServiceContext {
  return {
    actorRef: "public:anonymous",
    orgRef: "public",
    requestId: req.id,
    systemScope: false,
  };
}