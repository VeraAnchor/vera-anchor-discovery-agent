import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { executeProofBundleExport } from "../services/proofExecutionService.js";

const ExecuteActionParamsSchema = z.object({
  actionId: z.string().min(1).max(128),
});

const ExecuteActionBodySchema = z.object({
  payment_transaction_id: z.string().min(8).max(128),
  payer_account_id: z.string().min(1).max(64).optional(),
});

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/actions/:actionId/execute",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = ExecuteActionParamsSchema.parse(req.params);
      const body = ExecuteActionBodySchema.parse(req.body);

      const result = await executeProofBundleExport({
        actionId: params.actionId,
        paymentTransactionId: body.payment_transaction_id,
        ...(body.payer_account_id ? { payerAccountId: body.payer_account_id } : {}),
      });

      return reply.send(result);
    }
  );
}