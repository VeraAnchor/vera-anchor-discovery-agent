// apps/agent-api/src/routes/paidAgentActionRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createProofBundleQuote } from "../services/quoteService.js";
import { getActionPaymentRequirements } from "../services/paymentRequirementService.js";
import { getProofReceipt } from "../services/proofExecutionService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const PROOF_EXPORT_QUOTE_ROUTE = "/v1/explorer/agent/proof-exports/quote";
const ACTION_PAYMENT_REQUIREMENTS_ROUTE =
  "/v1/actions/:actionId/payment-requirements";
const PROOF_EXPORT_RECEIPT_ROUTE =
  "/v1/explorer/agent/proof-exports/receipts/:receiptId";

function setNoStore(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("x-content-type-options", "nosniff");
}

function getPathParam(
  params: unknown,
  key: string,
): string | undefined {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    return undefined;
  }

  const value = (params as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export async function paidAgentActionRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    PROOF_EXPORT_QUOTE_ROUTE,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["subjectType", "subjectId"],
          properties: {
            subjectType: {
              type: "string",
              minLength: 1,
              maxLength: 128,
            },
            subjectId: {
              type: "string",
              minLength: 1,
              maxLength: 256,
            },
            idempotencyKey: {
              anyOf: [
                {
                  type: "string",
                  minLength: 8,
                  maxLength: 256,
                },
                { type: "null" },
              ],
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const context = buildAgentServiceContext(req);
      const body = req.body as {
        subjectType?: unknown;
        subjectId?: unknown;
        idempotencyKey?: unknown;
      };

      const quote = await createProofBundleQuote(
        {
          subjectType: String(body.subjectType ?? ""),
          subjectId: String(body.subjectId ?? ""),
          idempotencyKey:
            body.idempotencyKey == null
              ? null
              : String(body.idempotencyKey),
        },
        context,
      );

      const paymentRequirements = await getActionPaymentRequirements(
        {
          actionId: quote.action_id,
        },
        context,
      );

      req.log.info(
        {
          reqId: req.id,
          route: PROOF_EXPORT_QUOTE_ROUTE,
          actionId: quote.action_id,
          quoteId: quote.quote_id,
          subjectType: quote.action_type,
          network: quote.network,
        },
        "paid_agent_proof_export_quote_created",
      );

      return setNoStore(reply).send({
        ok: true,
        kind: "paid_agent_proof_export_quote",
        quote,
        payment_requirements: paymentRequirements,
      });
    },
  );

  app.get(
    ACTION_PAYMENT_REQUIREMENTS_ROUTE,
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["actionId"],
          properties: {
            actionId: {
              type: "string",
              minLength: 1,
              maxLength: 64,
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const context = buildAgentServiceContext(req);
      const actionId = getPathParam(req.params, "actionId");

      const paymentRequirements = await getActionPaymentRequirements(
        {
          actionId: actionId ?? "",
        },
        context,
      );

      req.log.info(
        {
          reqId: req.id,
          route: ACTION_PAYMENT_REQUIREMENTS_ROUTE,
          actionId,
        },
        "paid_agent_payment_requirements_returned",
      );

      return setNoStore(reply).send(paymentRequirements);
    },
  );

  app.get(
    PROOF_EXPORT_RECEIPT_ROUTE,
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["receiptId"],
          properties: {
            receiptId: {
              type: "string",
              minLength: 1,
              maxLength: 64,
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: true,
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const context = buildAgentServiceContext(req);
      const receiptId = getPathParam(req.params, "receiptId");

      const receipt = await getProofReceipt(receiptId ?? "", context);

      if (!receipt) {
        return setNoStore(reply).status(404).send({
          error: "RECEIPT_NOT_FOUND",
        });
      }

      return setNoStore(reply).send({
        ok: true,
        kind: "paid_agent_proof_export_receipt",
        receipt,
      });
    },
  );
}