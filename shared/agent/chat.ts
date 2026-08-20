import { z } from "zod";
import { AGENT_MAX_MESSAGES } from "./constants";
import { InferenceBackendIdSchema } from "./settings";
import {
  AgentConfirmationCategorySchema,
  AgentToolErrorCodeSchema,
} from "./toolProtocol";

export const AgentChatMessageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type AgentChatMessageRole = z.infer<typeof AgentChatMessageRoleSchema>;

export const AgentToolStepSchema = z
  .object({
    id: z.string().min(1),
    toolName: z.string().min(1),
    status: z.enum(["running", "success", "error"]),
    summary: z.string().optional(),
    error: z
      .object({
        code: AgentToolErrorCodeSchema,
        message: z.string(),
        suggestedFix: z.string().optional(),
        approvalId: z.string().optional(),
        confirmationCategory: AgentConfirmationCategorySchema.optional(),
        currentVersion: z.string().optional(),
      })
      .strict()
      .optional(),
    isReadTool: z.boolean().default(false),
  })
  .strict();

export type AgentToolStep = z.infer<typeof AgentToolStepSchema>;

export const AgentToolCallSchema = z
  .object({
    id: z.string().min(1),
    toolName: z.string().min(1),
    input: z.unknown(),
  })
  .strict();

export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AgentToolApprovalRequestSchema = z
  .object({
    approvalId: z.string().min(1),
    toolCallId: z.string().min(1),
    signature: z.string().optional(),
  })
  .strict();
export type AgentToolApprovalRequest = z.infer<
  typeof AgentToolApprovalRequestSchema
>;

export const AgentToolApprovalResponseSchema = z
  .object({
    approvalId: z.string().min(1),
    approved: z.boolean(),
    reason: z.string().optional(),
  })
  .strict();
export type AgentToolApprovalResponse = z.infer<
  typeof AgentToolApprovalResponseSchema
>;

export const AgentChatMessageSchema = z
  .object({
    id: z.string().min(1),
    role: AgentChatMessageRoleSchema,
    content: z.string(),
    createdAt: z.string().datetime(),
    toolSteps: z.array(AgentToolStepSchema).optional(),
    stopped: z.boolean().optional(),
    toolCallId: z.string().optional(),
    toolCalls: z.array(AgentToolCallSchema).optional(),
    approvalRequests: z.array(AgentToolApprovalRequestSchema).optional(),
    approvalResponses: z.array(AgentToolApprovalResponseSchema).optional(),
    reasoning: z.string().optional(),
  })
  .strict();

export type AgentChatMessage = z.infer<typeof AgentChatMessageSchema>;

const AgentComposerModeValueSchema = z.enum(["ask", "agent"]);

export const AgentComposerModeSchema = z.preprocess(
  (value) => (value === "plan" ? "ask" : value),
  AgentComposerModeValueSchema,
);
export type AgentComposerMode = z.infer<typeof AgentComposerModeSchema>;

export const DEFAULT_AGENT_COMPOSER_MODE: AgentComposerMode = "agent";

export const AgentSessionModelOverrideSchema = z
  .object({
    inferenceProvider: InferenceBackendIdSchema.optional(),
    modelId: z.string().min(1).max(128).optional(),
  })
  .strict();

export type AgentSessionModelOverride = z.infer<
  typeof AgentSessionModelOverrideSchema
>;

export const AgentSessionPrefsSchema = z
  .object({
    composerMode: AgentComposerModeSchema.default("agent"),
    inferenceProvider: InferenceBackendIdSchema.optional(),
    modelId: z.string().min(1).max(128).optional(),
  })
  .strict();

export type AgentSessionPrefs = z.infer<typeof AgentSessionPrefsSchema>;

export const DEFAULT_AGENT_SESSION_PREFS: AgentSessionPrefs =
  AgentSessionPrefsSchema.parse({});

export function parseAgentSessionPrefs(input: unknown): AgentSessionPrefs {
  return AgentSessionPrefsSchema.parse(input ?? {});
}

export const AgentWorkspaceSchema = z.enum([
  "studio",
  "composer",
  "design",
  "collections",
]);
export type AgentWorkspace = z.infer<typeof AgentWorkspaceSchema>;

export const AgentShellModeSchema = z.enum(["studio", "composer"]);
export type AgentShellMode = z.infer<typeof AgentShellModeSchema>;

export const AgentShellContextSchema = z
  .object({
    mode: AgentShellModeSchema,
    workspace: AgentWorkspaceSchema,
    itemType: z.enum(["page", "layout", "component"]).nullable(),
    itemSlug: z.string().nullable(),
    itemTitle: z.string().nullable(),
    pageId: z.string().nullable(),
    selectedBlockId: z.string().nullable(),
    blockCount: z.number().int().nonnegative(),
    canClientInsert: z.boolean(),
    canClientNavigate: z.boolean(),
    routeContext: z
      .object({
        path: z.string().min(1),
        name: z.string().optional(),
        section: z.string().optional(),
      })
      .strict()
      .optional(),
    siteContext: z
      .object({
        siteName: z.string().optional(),
        siteUrl: z.string().optional(),
      })
      .strict()
      .optional(),
    contextSequence: z.number().int().nonnegative().optional(),
    documentContext: z
      .object({
        type: z.enum(["page", "layout", "component"]),
        file: z.string().min(1),
        revision: z.string().optional(),
        mtimeMs: z.number().nonnegative().nullable(),
        editable: z.boolean(),
        dirty: z.boolean(),
        emptyDocument: z.boolean().optional(),
        selectedNodePath: z.string().nullable(),
        selectedNodeType: z.string().nullable(),
        selectedNodeTag: z.string().nullable().optional(),
        selectedNodeClasses: z.array(z.string().min(1).max(120)).max(40).optional(),
        utilityStyles: z
          .object({
            framework: z.enum(["tailwind", "unocss", "none"]),
            enabled: z.boolean(),
            confidence: z.enum(["none", "package", "configured"]),
            sources: z.array(z.string().min(1).max(500)).max(20),
            diagnostics: z.array(z.string().min(1).max(500)).max(20),
          })
          .strict()
          .optional(),
        outline: z
          .array(
            z
              .object({
                path: z.string(),
                type: z.string(),
                label: z.string().max(160),
                depth: z.number().int().nonnegative(),
              })
              .strict(),
          )
          .max(80),
      })
      .strict()
      .optional(),
    designContext: z
      .object({
        revision: z.string().min(1),
        classCount: z.number().int().nonnegative(),
        paletteCount: z.number().int().nonnegative(),
        fontFamilyCount: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    cmsContext: z
      .object({
        collectionId: z.string().min(1),
        entryId: z.string().min(1),
        version: z.string().min(1),
        status: z.string().min(1),
        sourceLocale: z.string().nullable(),
        activeLocale: z.string().nullable(),
        locales: z.array(z.string().min(1)).max(40),
        dirty: z.boolean(),
      })
      .strict()
      .optional(),
    capabilityFamilies: z
      .object({
        main: z.array(z.string().min(1)).max(40),
        renderer: z.array(z.string().min(1)).max(40),
      })
      .strict()
      .optional(),
  })
  .strict();

export type AgentShellContext = z.infer<typeof AgentShellContextSchema>;

export const AgentChatInputSchema = z
  .object({
    messages: z.array(AgentChatMessageSchema).min(1).max(250),
    composerMode: AgentComposerModeSchema.default("agent"),
    sessionModel: AgentSessionModelOverrideSchema.optional(),
    shellContext: AgentShellContextSchema.optional(),
  })
  .strict();

export type AgentChatInput = z.infer<typeof AgentChatInputSchema>;

export const LocalChatHistoryV1Schema = z
  .object({
    version: z.literal(1),
    messages: z.array(AgentChatMessageSchema).max(AGENT_MAX_MESSAGES),
  })
  .strict();

export type LocalChatHistoryV1 = z.infer<typeof LocalChatHistoryV1Schema>;

export const AgentConversationSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1).max(200),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    messages: z.array(AgentChatMessageSchema).max(AGENT_MAX_MESSAGES),
  })
  .strict();

export type AgentConversation = z.infer<typeof AgentConversationSchema>;

export type AgentConversationSummary = Pick<
  AgentConversation,
  "id" | "title" | "createdAt" | "updatedAt"
>;

export const LocalChatHistorySchema = z
  .object({
    version: z.literal(2),
    activeId: z.string().min(1),
    conversations: z.array(AgentConversationSchema),
  })
  .strict();

export type LocalChatHistory = z.infer<typeof LocalChatHistorySchema>;

export const AgentStreamEventSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("text-delta"),
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("reasoning"),
      delta: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-call"),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      args: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-result"),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      result: z.unknown(),
    })
    .strict(),
  z
    .object({
      type: z.literal("tool-approval-request"),
      approvalId: z.string().min(1),
      toolCallId: z.string().min(1),
      toolName: z.string().min(1),
      signature: z.string().optional(),
      summary: z.string().min(1),
      confirmationCategory: AgentConfirmationCategorySchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("error"),
      error: z.string(),
    })
    .strict(),
  z
    .object({
      type: z.literal("finish"),
      finishReason: z.enum([
        "stop",
        "length",
        "content-filter",
        "tool-calls",
        "error",
        "other",
      ]),
      usage: z
        .object({
          promptTokens: z.number().int().nonnegative(),
          completionTokens: z.number().int().nonnegative(),
        })
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("finished"),
    })
    .strict(),
]);
export type AgentStreamEvent = z.infer<typeof AgentStreamEventSchema>;
