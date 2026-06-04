// apps/agent-api/src/routes/explorerAgentRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runExplorerAgentQuery } from "../services/explorerAgentService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const QUERY_ROUTE = "/v1/explorer/agent/query";

type ExplorerAgentQueryBody = {
  question?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  hcsTransactionId?: unknown;
  hcsTopicId?: unknown;
  limit?: unknown;
};

function setNoStore(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("x-content-type-options", "nosniff");
}

function optionalStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function optionalNumberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

export async function explorerAgentRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    QUERY_ROUTE,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["question"],
          properties: {
            question: {
              type: "string",
              minLength: 1,
              maxLength: 1000,
            },
            subjectType: {
              anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }],
            },
            subjectId: {
              anyOf: [{ type: "string", maxLength: 256 }, { type: "null" }],
            },
            hcsTransactionId: {
              anyOf: [{ type: "string", maxLength: 128 }, { type: "null" }],
            },
            hcsTopicId: {
              anyOf: [{ type: "string", maxLength: 64 }, { type: "null" }],
            },
            limit: {
              anyOf: [
                {
                  type: "integer",
                  minimum: 1,
                  maximum: 25,
                },
                { type: "null" },
              ],
            },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: [
              "ok",
              "intent",
              "answer",
              "confidence",
              "sources",
              "tools",
              "policy",
              "warnings",
            ],
            properties: {
              ok: { type: "boolean", const: true },
              intent: {
                type: "string",
                enum: [
                  "agent_capabilities",
                  "evidence_search",
                  "evidence_preview",
                  "proof_chain_explain",
                  "hcs_transaction_verify",
                  "unknown",
                ],
              },
              answer: { type: "string" },
              confidence: {
                type: "string",
                enum: ["high", "medium", "low"],
              },
              sources: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["kind", "label", "ref", "href"],
                  properties: {
                    kind: { type: "string" },
                    label: { type: "string" },
                    ref: { type: "string" },
                    href: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                  },
                },
              },
              tools: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["tool_name", "audit_id", "status"],
                  properties: {
                    tool_name: { type: "string" },
                    audit_id: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    status: {
                      type: "string",
                      enum: ["completed", "rejected", "failed"],
                    },
                  },
                },
              },
              policy: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["operation", "allowed", "reason"],
                  properties: {
                    operation: { type: "string" },
                    allowed: { type: "boolean" },
                    reason: { type: "string" },
                  },
                },
              },
              warnings: {
                type: "array",
                items: { type: "string" },
              },
            },
          },
        },
      },
    },
    async (
      req: FastifyRequest<{ Body: ExplorerAgentQueryBody }>,
      reply: FastifyReply,
    ) => {
      const context = buildAgentServiceContext(req);
      const body = req.body;

      const result = await runExplorerAgentQuery(
        {
          question: String(body.question ?? ""),
          subjectType: optionalStringOrNull(body.subjectType),
          subjectId: optionalStringOrNull(body.subjectId),
          hcsTransactionId: optionalStringOrNull(body.hcsTransactionId),
          hcsTopicId: optionalStringOrNull(body.hcsTopicId),
          limit: optionalNumberOrNull(body.limit),
        },
        context,
      );

      req.log.info(
        {
          reqId: req.id,
          route: QUERY_ROUTE,
          intent: result.intent,
          confidence: result.confidence,
          sourceCount: result.sources.length,
          toolCount: result.tools.length,
          policyDecisionCount: result.policy.length,
          warningCount: result.warnings.length,
        },
        "explorer_agent_query_completed",
      );

      return setNoStore(reply).send(result);
    },
  );
}