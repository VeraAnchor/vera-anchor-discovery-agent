// apps/agent-api/src/routes/explorerAgentRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runExplorerAgentQuery } from "../services/explorerAgentService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const QUERY_ROUTE = "/v1/explorer/agent/query";

type ExplorerAgentQueryBody = {
  question?: unknown;
  mode?: unknown;
  subjectType?: unknown;
  subjectId?: unknown;
  hcsTransactionId?: unknown;
  hcsTopicId?: unknown;
  limit?: unknown;
  sort?: unknown;
  timeWindow?: unknown;
  datasetKey?: unknown;
  verifiedOnly?: unknown;
  anchoredOnly?: unknown;
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

function optionalBooleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
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
            mode: {
              anyOf: [
                {
                  type: "string",
                  enum: [
                    "search",
                    "explain_selected",
                    "verify_hcs",
                    "capabilities",
                  ],
                },
                { type: "null" },
              ],
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
            sort: {
              anyOf: [
                {
                  type: "string",
                  enum: ["relevance", "latest", "highest_score"],
                },
                { type: "null" },
              ],
            },
            timeWindow: {
              anyOf: [
                {
                  type: "string",
                  enum: ["any", "today", "last_24h", "last_7d", "last_30d"],
                },
                { type: "null" },
              ],
            },
            datasetKey: {
              anyOf: [{ type: "string", maxLength: 512 }, { type: "null" }],
            },
            verifiedOnly: {
              anyOf: [{ type: "boolean" }, { type: "null" }],
            },
            anchoredOnly: {
              anyOf: [{ type: "boolean" }, { type: "null" }],
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
              "evidence_items",
              "tools",
              "policy",
              "warnings",
              "verification",
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
              evidence_items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "subject_type",
                    "subject_id",
                    "title",
                    "summary",
                    "network",
                    "result_url",
                    "verify_url",
                    "proof_card_url",
                    "hcs_transaction_id",
                    "hcs_topic_id",
                  ],
                  properties: {
                    subject_type: {
                      type: "string",
                      enum: [
                        "sage_result",
                        "cipher_result",
                        "dataset",
                        "hcs_transaction",
                        "proof_card",
                      ],
                    },
                    subject_id: { type: "string" },
                    title: { type: "string" },
                    summary: { type: "string" },
                    network: { type: "string" },
                    result_url: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    verify_url: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    proof_card_url: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    hcs_transaction_id: {
                      anyOf: [{ type: "string" }, { type: "null" }],
                    },
                    hcs_topic_id: {
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
              verification: {
                anyOf: [
                  {
                    type: "object",
                    additionalProperties: false,
                    required: [
                      "kind",
                      "verified",
                      "verification_level",
                      "transaction_id",
                      "topic_id",
                      "consensus_timestamp",
                      "sequence_number",
                      "running_hash",
                      "payer_account_id",
                      "transaction_result",
                      "warnings",
                    ],
                    properties: {
                      kind: {
                        type: "string",
                        const: "hcs_receipt",
                      },
                      verified: { type: "boolean" },
                      verification_level: {
                        type: "string",
                        const: "receipt_metadata",
                      },
                      transaction_id: { type: "string" },
                      topic_id: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      consensus_timestamp: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      sequence_number: {
                        anyOf: [{ type: "number" }, { type: "null" }],
                      },
                      running_hash: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      payer_account_id: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      transaction_result: {
                        anyOf: [{ type: "string" }, { type: "null" }],
                      },
                      warnings: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                  },
                  { type: "null" },
                ],
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
          mode: optionalStringOrNull(body.mode),
          subjectType: optionalStringOrNull(body.subjectType),
          subjectId: optionalStringOrNull(body.subjectId),
          hcsTransactionId: optionalStringOrNull(body.hcsTransactionId),
          hcsTopicId: optionalStringOrNull(body.hcsTopicId),
          limit: optionalNumberOrNull(body.limit),
          sort: optionalStringOrNull(body.sort),
          timeWindow: optionalStringOrNull(body.timeWindow),
          datasetKey: optionalStringOrNull(body.datasetKey),
          verifiedOnly: optionalBooleanOrNull(body.verifiedOnly),
          anchoredOnly: optionalBooleanOrNull(body.anchoredOnly),
        },
        context,
      );

      req.log.info(
        {
          reqId: req.id,
          route: QUERY_ROUTE,
          mode: optionalStringOrNull(body.mode),
          intent: result.intent,
          confidence: result.confidence,
          sourceCount: result.sources.length,
          evidenceItemCount: result.evidence_items.length,
          toolCount: result.tools.length,
          policyDecisionCount: result.policy.length,
          warningCount: result.warnings.length,
          verified: result.verification?.verified ?? null,
        },
        "explorer_agent_query_completed",
      );

      return setNoStore(reply).send(result);
    },
  );
}