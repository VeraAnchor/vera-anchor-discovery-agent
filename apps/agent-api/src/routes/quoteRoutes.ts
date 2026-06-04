// apps/agent-api/src/routes/quoteRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createProofBundleQuote } from "../services/quoteService.js";
import { getActionPaymentRequirements } from "../services/paymentRequirementService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const CreateQuoteBodySchema = z.object({
  action_type: z.literal("proof_bundle_export"),
  subject_type: z.string().min(1).max(128),
  subject_id: z.string().min(1).max(256),
  idempotency_key: z.string().min(8).max(256).optional().nullable(),
});

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/quotes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = CreateQuoteBodySchema.parse(req.body);
      const context = buildAgentServiceContext(req);

      const quote = await createProofBundleQuote(
        {
          subjectType: body.subject_type,
          subjectId: body.subject_id,
          idempotencyKey: body.idempotency_key ?? null,
        },
        context,
      );

      const paymentRequirements = await getActionPaymentRequirements(
        {
          actionId: quote.action_id,
        },
        context,
      );

      return reply
        .code(201)
        .header("cache-control", "no-store")
        .send({
          ...quote,
          payment_requirements: paymentRequirements,
      });
    },
  );
}