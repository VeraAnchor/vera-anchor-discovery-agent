// apps/agent-api/src/routes/actionRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { executeProofBundleExport } from "../services/proofExecutionService.js";
import { getActionPaymentRequirements } from "../services/paymentRequirementService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const ExecuteActionParamsSchema = z.object({
  actionId: z.string().uuid(),
});

const ExecuteActionBodySchema = z.object({
  payment_transaction_id: z.string().min(8).max(128).optional().nullable(),
  payer_account_id: z.string().min(1).max(64).optional().nullable(),
});

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/actions/:actionId/execute",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = ExecuteActionParamsSchema.parse(req.params);
      const body = ExecuteActionBodySchema.parse(req.body ?? {});
      const context = buildAgentServiceContext(req);

      if (!body.payment_transaction_id) {
        const requirements = await getActionPaymentRequirements(
          {
            actionId: params.actionId,
          },
          context,
        );

        return reply
          .code(402)
          .header("cache-control", "no-store")
          .header("x-402-version", String(requirements.x402_version))
          .send({
            error: "PAYMENT_REQUIRED",
            message:
              "Payment is required to execute this action. Complete the selected Hedera payment requirement and retry with payment_transaction_id.",
            payment_requirements: requirements,
          });
      }

      const result = await executeProofBundleExport(
        {
          actionId: params.actionId,
          paymentTransactionId: body.payment_transaction_id,
          payerAccountId: body.payer_account_id ?? null,
        },
        context,
      );

      return reply.send(result);
    },
  );
}