// apps/agent-api/src/routes/evidenceRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getEvidencePreview, searchEvidence } from "../services/evidenceService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const EvidenceSearchQuerySchema = z.object({
  q: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(25).optional(),
  type: z.string().max(128).optional(),
  sort: z.enum(["relevance", "latest", "highest_score"]).optional(),
  timeWindow: z
    .enum(["any", "today", "last_24h", "last_7d", "last_30d"])
    .optional(),
  datasetKey: z.string().min(1).max(512).optional(),
  verifiedOnly: z.coerce.boolean().optional(),
  anchoredOnly: z.coerce.boolean().optional(),
});

const EvidencePreviewParamsSchema = z.object({
  subjectType: z.string().min(1).max(128),
  subjectId: z.string().min(1).max(256),
});

export async function evidenceRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/v1/evidence/search",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const query = EvidenceSearchQuerySchema.parse(req.query);

      const result = await searchEvidence(
        {
          query: query.q,
          limit: query.limit,
          type: query.type,
          sort: query.sort,
          timeWindow: query.timeWindow,
          datasetKey: query.datasetKey,
          verifiedOnly: query.verifiedOnly,
          anchoredOnly: query.anchoredOnly,
        },
        buildAgentServiceContext(req),
      );

      return reply.send(result);
    },
  );

  app.get(
    "/v1/evidence/preview/:subjectType/:subjectId",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = EvidencePreviewParamsSchema.parse(req.params);

      const result = await getEvidencePreview(
        {
          subjectType: params.subjectType,
          subjectId: params.subjectId,
        },
        buildAgentServiceContext(req),
      );

      return reply.send(result);
    },
  );
}