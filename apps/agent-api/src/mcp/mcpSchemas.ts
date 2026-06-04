// apps/agent-api/src/mcp/mcpSchemas.ts

import { z } from "zod";

export const MCP_TOOL_NAMES = {
  SEARCH_EVIDENCE: "vera.search_evidence",
  PREVIEW_EVIDENCE: "vera.preview_evidence",
  CREATE_PROOF_BUNDLE_QUOTE: "vera.create_proof_bundle_quote",
  GET_PAYMENT_REQUIREMENTS: "vera.get_payment_requirements",
  EXECUTE_PROOF_BUNDLE_EXPORT: "vera.execute_proof_bundle_export",
  GET_RECEIPT: "vera.get_receipt",
} as const;

export type VeraMcpToolName =
  (typeof MCP_TOOL_NAMES)[keyof typeof MCP_TOOL_NAMES];

const SubjectTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z][a-z0-9_:-]{1,127}$/);

const SubjectIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "subject_id contains control characters",
  });

const ActionIdSchema = z.string().uuid();

const ReceiptIdSchema = z.string().uuid();

const IdempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "idempotency_key contains control characters",
  });

const PaymentTransactionIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "payment_transaction_id contains control characters",
  });

const PayerAccountIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^0\.0\.\d+$/);

const SearchQuerySchema = z
  .string()
  .trim()
  .max(256)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "query contains control characters",
  });

const EvidenceTypeSchema = z
  .string()
  .trim()
  .max(128)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: "type contains control characters",
  });

export const VeraSearchEvidenceInputSchema = z
  .object({
    q: SearchQuerySchema.optional().nullable(),
    query: SearchQuerySchema.optional().nullable(),
    type: EvidenceTypeSchema.optional().nullable(),
    limit: z.coerce.number().int().min(1).max(25).optional().nullable(),
  })
  .strict();

export const VeraPreviewEvidenceInputSchema = z
  .object({
    subject_type: SubjectTypeSchema,
    subject_id: SubjectIdSchema,
  })
  .strict();

export const VeraCreateProofBundleQuoteInputSchema = z
  .object({
    subject_type: SubjectTypeSchema,
    subject_id: SubjectIdSchema,
    idempotency_key: IdempotencyKeySchema.optional().nullable(),
  })
  .strict();

export const VeraGetPaymentRequirementsInputSchema = z
  .object({
    action_id: ActionIdSchema,
  })
  .strict();

export const VeraExecuteProofBundleExportInputSchema = z
  .object({
    action_id: ActionIdSchema,
    payment_transaction_id: PaymentTransactionIdSchema.optional().nullable(),
    payer_account_id: PayerAccountIdSchema.optional().nullable(),
  })
  .strict();

export const VeraGetReceiptInputSchema = z
  .object({
    receipt_id: ReceiptIdSchema,
  })
  .strict();

export type VeraSearchEvidenceInput = z.infer<
  typeof VeraSearchEvidenceInputSchema
>;

export type VeraPreviewEvidenceInput = z.infer<
  typeof VeraPreviewEvidenceInputSchema
>;

export type VeraCreateProofBundleQuoteInput = z.infer<
  typeof VeraCreateProofBundleQuoteInputSchema
>;

export type VeraGetPaymentRequirementsInput = z.infer<
  typeof VeraGetPaymentRequirementsInputSchema
>;

export type VeraExecuteProofBundleExportInput = z.infer<
  typeof VeraExecuteProofBundleExportInputSchema
>;

export type VeraGetReceiptInput = z.infer<typeof VeraGetReceiptInputSchema>;

export const VERA_MCP_TOOL_INPUT_SCHEMAS = Object.freeze({
  [MCP_TOOL_NAMES.SEARCH_EVIDENCE]: VeraSearchEvidenceInputSchema,
  [MCP_TOOL_NAMES.PREVIEW_EVIDENCE]: VeraPreviewEvidenceInputSchema,
  [MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE]:
    VeraCreateProofBundleQuoteInputSchema,
  [MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS]:
    VeraGetPaymentRequirementsInputSchema,
  [MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT]:
    VeraExecuteProofBundleExportInputSchema,
  [MCP_TOOL_NAMES.GET_RECEIPT]: VeraGetReceiptInputSchema,
});

export type VeraMcpToolInputMap = Readonly<{
  [MCP_TOOL_NAMES.SEARCH_EVIDENCE]: VeraSearchEvidenceInput;
  [MCP_TOOL_NAMES.PREVIEW_EVIDENCE]: VeraPreviewEvidenceInput;
  [MCP_TOOL_NAMES.CREATE_PROOF_BUNDLE_QUOTE]: VeraCreateProofBundleQuoteInput;
  [MCP_TOOL_NAMES.GET_PAYMENT_REQUIREMENTS]: VeraGetPaymentRequirementsInput;
  [MCP_TOOL_NAMES.EXECUTE_PROOF_BUNDLE_EXPORT]: VeraExecuteProofBundleExportInput;
  [MCP_TOOL_NAMES.GET_RECEIPT]: VeraGetReceiptInput;
}>;

export type VeraMcpToolInput<T extends VeraMcpToolName> =
  VeraMcpToolInputMap[T];

export function parseVeraMcpToolInput<T extends VeraMcpToolName>(
  toolName: T,
  input: unknown,
): VeraMcpToolInput<T> {
  const schema = VERA_MCP_TOOL_INPUT_SCHEMAS[toolName];

  return schema.parse(input) as VeraMcpToolInput<T>;
}

export function isVeraMcpToolName(value: unknown): value is VeraMcpToolName {
  return (
    typeof value === "string" &&
    Object.values(MCP_TOOL_NAMES).includes(value as VeraMcpToolName)
  );
}