// apps/agent-api/src/routes/hederaAgentRoutes.ts

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  getHederaAgentRuntimeStatus,
  readHederaAgentHcsMessage,
  readHederaAgentMirrorTransaction,
  verifyHederaAgentHcsReceipt,
} from "../services/hederaAgentService.js";
import { buildAgentServiceContext } from "./routeContext.js";

const STATUS_ROUTE = "/v1/hedera/agent/status";
const MIRROR_TRANSACTION_READ_ROUTE =
  "/v1/hedera/agent/mirror/transaction/read";
const HCS_MESSAGE_READ_ROUTE = "/v1/hedera/agent/hcs/message/read";
const HCS_RECEIPT_VERIFY_ROUTE = "/v1/hedera/agent/hcs/receipt/verify";

function setNoStore(reply: FastifyReply): FastifyReply {
  return reply
    .header("cache-control", "no-store, max-age=0")
    .header("pragma", "no-cache")
    .header("x-content-type-options", "nosniff");
}

export async function hederaAgentRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    STATUS_ROUTE,
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: true,
            required: [
              "ok",
              "network",
              "agent_kit",
              "operator",
              "treasury",
              "payments",
              "safety",
              "policy",
            ],
            properties: {
              ok: { type: "boolean", const: true },
              network: {
                type: "string",
                enum: ["mainnet", "testnet", "previewnet"],
              },
              agent_kit: {
                type: "object",
                additionalProperties: true,
                required: ["enabled", "package_name", "loaded", "mode"],
                properties: {
                  enabled: { type: "boolean" },
                  package_name: { type: "string" },
                  loaded: { type: "boolean" },
                  mode: { type: "string" },
                  load_error: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                },
              },
              operator: {
                type: "object",
                additionalProperties: false,
                required: ["account_id", "configured"],
                properties: {
                  account_id: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  configured: { type: "boolean" },
                },
              },
              treasury: {
                type: "object",
                additionalProperties: false,
                required: ["account_id", "configured"],
                properties: {
                  account_id: {
                    anyOf: [{ type: "string" }, { type: "null" }],
                  },
                  configured: { type: "boolean" },
                },
              },
              payments: {
                type: "object",
                additionalProperties: false,
                required: ["asset", "verification_mode", "x402_version"],
                properties: {
                  asset: { type: "string", const: "HBAR" },
                  verification_mode: {
                    type: "string",
                    enum: ["demo", "mirror", "disabled"],
                  },
                  x402_version: { type: "number", const: 1 },
                },
              },
              safety: {
                type: "object",
                additionalProperties: true,
                required: [
                  "autonomous_user_fund_transfers",
                  "arbitrary_tool_execution",
                  "raw_agent_kit_client_exposed",
                  "user_private_keys_accepted",
                  "mainnet_writes_enabled",
                  "hcs_receipt_anchoring_enabled",
                  "user_writes_enabled",
                  "human_approval_required_for_writes",
                ],
                properties: {
                  autonomous_user_fund_transfers: {
                    type: "boolean",
                    const: false,
                  },
                  arbitrary_tool_execution: {
                    type: "boolean",
                    const: false,
                  },
                  raw_agent_kit_client_exposed: {
                    type: "boolean",
                    const: false,
                  },
                  user_private_keys_accepted: {
                    type: "boolean",
                    const: false,
                  },
                  mainnet_writes_enabled: { type: "boolean" },
                  hcs_receipt_anchoring_enabled: { type: "boolean" },
                  user_writes_enabled: { type: "boolean" },
                  human_approval_required_for_writes: {
                    type: "boolean",
                    const: true,
                  },
                },
              },
              policy: {
                type: "object",
                additionalProperties: false,
                required: ["decisions"],
                properties: {
                  decisions: {
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
                },
              },
            },
          },
        },
      },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const context = buildAgentServiceContext(req);
      const status = await getHederaAgentRuntimeStatus(context);

      req.log.info(
        {
          reqId: req.id,
          route: STATUS_ROUTE,
          network: status.network,
          agentKitLoaded: status.agent_kit.loaded,
          verificationMode: status.payments.verification_mode,
          mainnetWritesEnabled: status.safety.mainnet_writes_enabled,
          hcsReceiptAnchoringEnabled:
            status.safety.hcs_receipt_anchoring_enabled,
          userWritesEnabled: status.safety.user_writes_enabled,
        },
        "hedera_agent_status_checked",
      );

      return setNoStore(reply).send(status);
    },
  );
  app.post(
    MIRROR_TRANSACTION_READ_ROUTE,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["transactionId"],
          properties: {
            transactionId: { type: "string", minLength: 1, maxLength: 256 },
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
      const body = req.body as { transactionId?: unknown };
      const result = await readHederaAgentMirrorTransaction(body, context);

      req.log.info(
        {
          reqId: req.id,
          route: MIRROR_TRANSACTION_READ_ROUTE,
          transactionId: result.transaction_id,
          found: result.found,
          network: result.network,
        },
        "hedera_agent_mirror_transaction_read",
      );

      return setNoStore(reply).send(result);
    },
  );

  app.post(
    HCS_MESSAGE_READ_ROUTE,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["topicId"],
          properties: {
            topicId: { type: "string", minLength: 1, maxLength: 256 },
            transactionId: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
            },
            consensusTimestamp: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
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
        topicId?: unknown;
        transactionId?: unknown;
        consensusTimestamp?: unknown;
      };
      const result = await readHederaAgentHcsMessage(body, context);

      req.log.info(
        {
          reqId: req.id,
          route: HCS_MESSAGE_READ_ROUTE,
          topicId: result.topic_id,
          transactionId: result.transaction_id,
          found: result.found,
          network: result.network,
        },
        "hedera_agent_hcs_message_read",
      );

      return setNoStore(reply).send(result);
    },
  );

  app.post(
    HCS_RECEIPT_VERIFY_ROUTE,
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["transactionId"],
          properties: {
            transactionId: { type: "string", minLength: 1, maxLength: 256 },
            topicId: {
              anyOf: [{ type: "string", minLength: 1, maxLength: 256 }, { type: "null" }],
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
        transactionId?: unknown;
        topicId?: unknown;
      };
      const result = await verifyHederaAgentHcsReceipt(body, context);

      req.log.info(
        {
          reqId: req.id,
          route: HCS_RECEIPT_VERIFY_ROUTE,
          transactionId: result.transaction_id,
          topicId: result.topic_id,
          verified: result.verified,
          network: result.network,
        },
        "hedera_agent_hcs_receipt_verified",
      );

      return setNoStore(reply).send(result);
    },
  );
}