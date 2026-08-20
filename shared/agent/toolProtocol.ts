import { z } from "zod";

export const AgentToolErrorCodeSchema = z.enum([
  "INVALID_INPUT",
  "NOT_FOUND",
  "CONFLICT",
  "VERSION_CONFLICT",
  "CONTENT_IN_USE",
  "UNSAVED_CHANGES",
  "NO_OPEN_DOCUMENT",
  "DOCUMENT_NOT_EDITABLE",
  "PLATFORM_UNAVAILABLE",
  "CONFIRMATION_REQUIRED",
  "CONFIRMATION_DENIED",
  "PROVIDER_ERROR",
  "INTERNAL",
]);
export type AgentToolErrorCode = z.infer<typeof AgentToolErrorCodeSchema>;

export const AgentConfirmationCategorySchema = z.enum([
  "delete_content",
  "publish_lifecycle",
  "replace_content",
  "bulk_operation",
]);
export type AgentConfirmationCategory = z.infer<
  typeof AgentConfirmationCategorySchema
>;

export const AgentToolErrorSchema = z
  .object({
    code: AgentToolErrorCodeSchema,
    message: z.string().min(1),
    suggestedFix: z.string().optional(),
    approvalId: z.string().optional(),
    confirmationCategory: AgentConfirmationCategorySchema.optional(),
    retryAfterMs: z.number().int().positive().optional(),
    currentVersion: z.string().optional(),
  })
  .strict();
export type AgentToolError = z.infer<typeof AgentToolErrorSchema>;

export type AgentToolResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: AgentToolError };

export const AgentToolResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), data: z.unknown() }).strict(),
  z.object({ ok: z.literal(false), error: AgentToolErrorSchema }).strict(),
]);

export const AgentToolExecutionPlaneSchema = z.enum(["main", "renderer"]);
export type AgentToolExecutionPlane = z.infer<
  typeof AgentToolExecutionPlaneSchema
>;

export const AgentToolMutationClassSchema = z.enum(["read", "write"]);
export type AgentToolMutationClass = z.infer<
  typeof AgentToolMutationClassSchema
>;

export function agentToolOk<T>(data: T): AgentToolResult<T> {
  return { ok: true, data };
}

export function agentToolFail(
  code: AgentToolErrorCode,
  message: string,
  extras: Omit<AgentToolError, "code" | "message"> = {},
): AgentToolResult<never> {
  return { ok: false, error: { code, message, ...extras } };
}
