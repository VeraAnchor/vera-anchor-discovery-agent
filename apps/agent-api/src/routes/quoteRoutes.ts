import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createProofBundleQuote } from "../services/quoteService.js";

const CreateQuoteBodySchema = z.object({
  action_type: z.literal("proof_bundle_export"),
  subject_type: z.string().min(1).max(128),
  subject_id: z.string().min(1).max(256),
});

export async function quoteRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/quotes",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const body = CreateQuoteBodySchema.parse(req.body);

      const quote = await createProofBundleQuote({
        subjectType: body.subject_type,
        subjectId: body.subject_id,
      });

      return reply.code(201).send(quote);
    }
  );
}