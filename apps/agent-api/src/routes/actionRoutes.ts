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
}).strict();

function setNoStore(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("x-content-type-options", "nosniff");
}

function parseExecuteActionParams(
  value: unknown,
  reply: FastifyReply,
): z.infer<typeof ExecuteActionParamsSchema> | null {
  const parsed = ExecuteActionParamsSchema.safeParse(value);

  if (parsed.success) {
    return parsed.data;
  }

  setNoStore(reply).code(400).send({
    error: "INVALID_ACTION_ID",
    message: "The actionId path parameter must be a valid UUID.",
    issues: parsed.error.issues,
  });

  return null;
}

export async function actionRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/actions/:actionId/execute",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = parseExecuteActionParams(req.params, reply);

      if (!params) {
        return reply;
      }

      const bodyParsed = ExecuteActionBodySchema.safeParse(req.body ?? {});

      if (!bodyParsed.success) {
        return setNoStore(reply).code(400).send({
          error: "INVALID_EXECUTE_ACTION_BODY",
          message:
            "The execute request body must include optional payment_transaction_id and optional payer_account_id fields.",
          issues: bodyParsed.error.issues,
        });
      }

      const body = bodyParsed.data;
      const context = buildAgentServiceContext(req);

      if (!body.payment_transaction_id) {
        const requirements = await getActionPaymentRequirements(
          {
            actionId: params.actionId,
          },
          context,
        );

        return setNoStore(reply)
          .code(402)
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

      return setNoStore(reply).send(result);
    },
  );
}