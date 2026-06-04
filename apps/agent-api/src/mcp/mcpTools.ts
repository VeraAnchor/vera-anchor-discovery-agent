// apps/agent-api/src/mcp/mcpTools.ts

import type { AgentServiceContext } from "../services/agentServiceContext.js";
import { searchEvidence, getEvidencePreview } from "../services/evidenceService.js";
import { createProofBundleQuote } from "../services/quoteService.js";
import { getActionPaymentRequirements } from "../services/paymentRequirementService.js";
import {
  executeProofBundleExport,
  getProofReceipt,
} from "../services/proofExecutionService.js";
import { withMcpAudit } from "../services/mcpAuditService.js";
import {
  MCP_TOOL_NAMES,
  parseVeraMcpToolInput,
  type VeraCreateProofBundleQuoteInput,
  type VeraExecuteProofBundleExportInput,
  type VeraGetPaymentRequirementsInput,
  type VeraGetReceiptInput,
  type VeraMcpToolName,
  type VeraPreviewEvidenceInput,
  type VeraSearchEvidenceInput,
} from "./mcpSchemas.js";

export type VeraMcpExecutionContext = Readonly<{
  serviceContext: AgentServiceContext;
  sessionId?: string | null;
  clientRef?: string | null;
}>;

export type VeraMcpToolEnvelope<T> = Readonly<{
  ok: true;
  tool_name: VeraMcpToolName;
  mcp_audit_id: string | null;
  data: T;
}>;

export type VeraMcpPaymentRequiredResult = Readonly<{
  status: "payment_required";
  action_id: string;
  payment_requirements: Awaited<ReturnType<typeof getActionPaymentRequirements>>;
}>;

function metadataForTool(input: {
  source?: string;
  paymentRequired?: boolean;
}): Record<string, unknown> {
  return {
    source: input.source ?? "mcp",
    payment_required: Boolean(input.paymentRequired),
  };
}

function envelope<T>(input: {
  toolName: VeraMcpToolName;
  auditId: string | null;
  data: T;
}): VeraMcpToolEnvelope<T> {
  return Object.freeze({
    ok: true,
    tool_name: input.toolName,
    mcp_audit_id: input.auditId,
    data: input.data,
  });
}

export async function veraSearchEvidenceTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<VeraMcpToolEnvelope<Awaited<ReturnType<typeof searchEvidence>>>> {
  const toolName = MCP_TOOL_NAMES.SEARCH_EVIDENCE;
  const input = parseVeraMcpToolInput(toolName, rawInput) as VeraSearchEvidenceInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({ source: "mcp_tool" }),
    },
    async () => {
      return searchEvidence(
        {
          query: input.query ?? input.q ?? null,
          type: input.type ?? null,
          limit: input.limit ?? null,
        },
        context.serviceContext,
      );
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export async function veraPreviewEvidenceTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<VeraMcpToolEnvelope<Awaited<ReturnType<typeof getEvidencePreview>>>> {
  const toolName = MCP_TOOL_NAMES.PREVIEW_EVIDENCE;
  const input = parseVeraMcpToolInput(toolName, rawInput) as VeraPreviewEvidenceInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({ source: "mcp_tool" }),
    },
    async () => {
      return getEvidencePreview(
        {
          subjectType: input.subject_type,
          subjectId: input.subject_id,
        },
        context.serviceContext,
      );
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export async function veraCreateProofBundleQuoteTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<
  VeraMcpToolEnvelope<Awaited<ReturnType<typeof createProofBundleQuote>>>
> {
  const toolName = MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE;
  const input = parseVeraMcpToolInput(
    toolName,
    rawInput,
  ) as VeraCreateProofBundleQuoteInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({ source: "mcp_tool" }),
    },
    async () => {
      return createProofBundleQuote(
        {
          subjectType: input.subject_type,
          subjectId: input.subject_id,
          idempotencyKey: input.idempotency_key ?? null,
        },
        context.serviceContext,
      );
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export async function veraGetPaymentRequirementsTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<
  VeraMcpToolEnvelope<Awaited<ReturnType<typeof getActionPaymentRequirements>>>
> {
  const toolName = MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS;
  const input = parseVeraMcpToolInput(
    toolName,
    rawInput,
  ) as VeraGetPaymentRequirementsInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      actionId: input.action_id,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({ source: "mcp_tool" }),
    },
    async () => {
      return getActionPaymentRequirements(
        {
          actionId: input.action_id,
        },
        context.serviceContext,
      );
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export async function veraExecuteProofBundleExportTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<
  VeraMcpToolEnvelope<
    | Awaited<ReturnType<typeof executeProofBundleExport>>
    | VeraMcpPaymentRequiredResult
  >
> {
  const toolName = MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT;
  const input = parseVeraMcpToolInput(
    toolName,
    rawInput,
  ) as VeraExecuteProofBundleExportInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      actionId: input.action_id,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({
        source: "mcp_tool",
        paymentRequired: !input.payment_transaction_id,
      }),
    },
    async () => {
      if (!input.payment_transaction_id) {
        const paymentRequirements = await getActionPaymentRequirements(
          {
            actionId: input.action_id,
          },
          context.serviceContext,
        );

        return {
          status: "payment_required",
          action_id: input.action_id,
          payment_requirements: paymentRequirements,
        } satisfies VeraMcpPaymentRequiredResult;
      }

      return executeProofBundleExport(
        {
          actionId: input.action_id,
          paymentTransactionId: input.payment_transaction_id,
          payerAccountId: input.payer_account_id ?? null,
        },
        context.serviceContext,
      );
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export async function veraGetReceiptTool(
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<VeraMcpToolEnvelope<Awaited<ReturnType<typeof getProofReceipt>>>> {
  const toolName = MCP_TOOL_NAMES.GET_RECEIPT;
  const input = parseVeraMcpToolInput(toolName, rawInput) as VeraGetReceiptInput;

  const audited = await withMcpAudit(
    {
      toolName,
      input,
      context: context.serviceContext,
      sessionId: context.sessionId ?? null,
      clientRef: context.clientRef ?? null,
      metadata: metadataForTool({ source: "mcp_tool" }),
    },
    async () => {
      return getProofReceipt(input.receipt_id, context.serviceContext);
    },
  );

  return envelope({
    toolName,
    auditId: audited.audit?.id ?? null,
    data: audited.result,
  });
}

export const VERA_MCP_TOOLS = Object.freeze({
  [MCP_TOOL_NAMES.SEARCH_EVIDENCE]: veraSearchEvidenceTool,
  [MCP_TOOL_NAMES.PREVIEW_EVIDENCE]: veraPreviewEvidenceTool,
  [MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE]: veraCreateProofBundleQuoteTool,
  [MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS]: veraGetPaymentRequirementsTool,
  [MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT]:
    veraExecuteProofBundleExportTool,
  [MCP_TOOL_NAMES.GET_RECEIPT]: veraGetReceiptTool,
});

export async function executeVeraMcpTool(
  toolName: VeraMcpToolName,
  rawInput: unknown,
  context: VeraMcpExecutionContext,
): Promise<unknown> {
  switch (toolName) {
    case MCP_TOOL_NAMES.SEARCH_EVIDENCE:
      return veraSearchEvidenceTool(rawInput, context);

    case MCP_TOOL_NAMES.PREVIEW_EVIDENCE:
      return veraPreviewEvidenceTool(rawInput, context);

    case MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE:
      return veraCreateProofBundleQuoteTool(rawInput, context);

    case MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS:
      return veraGetPaymentRequirementsTool(rawInput, context);

    case MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT:
      return veraExecuteProofBundleExportTool(rawInput, context);

    case MCP_TOOL_NAMES.GET_RECEIPT:
      return veraGetReceiptTool(rawInput, context);

    default: {
      const neverTool: never = toolName;
      throw new Error(`Unsupported MCP tool: ${neverTool}`);
    }
  }
}