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
}).strict();

function parseCreateQuoteBody(value: unknown): z.infer<typeof CreateQuoteBodySchema> {
  const parsed = CreateQuoteBodySchema.safeParse(value);

  if (!parsed.success) {
    const err = new Error("INVALID_CREATE_QUOTE_BODY") as Error & {
      status?: number;
      details?: unknown;
    };

    err.status = 400;
    err.details = parsed.error.issues;
    throw err;
  }

  return parsed.data;
}

function setNoStore(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("x-content-type-options", "nosniff");
}

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/quotes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = parseCreateQuoteBody(req.body);
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

      return setNoStore(reply)
        .code(201)
        .send({
          ...quote,
          payment_requirements: paymentRequirements,
        });
    },
  );
}