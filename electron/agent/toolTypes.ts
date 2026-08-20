import type { z } from "zod";
import type {
  AgentComposerMode,
  AgentConfirmationCategory,
  AgentShellContext,
  AgentToolExecutionPlane,
  AgentToolMutationClass,
  AgentToolResult,
} from "../../shared/agent";

export type RendererToolExecutor = (
  name: string,
  input: unknown,
  signal?: AbortSignal,
) => Promise<AgentToolResult>;

export type AgentToolRuntime = {
  projectPath: string;
  userData: string;
  webContentsId: number;
  abortSignal?: AbortSignal;
  executeRendererTool?: RendererToolExecutor;
  rendererCapabilities?: {
    navigation: boolean;
    document: boolean;
  };
  shellContext?: AgentShellContext;
  composerMode?: AgentComposerMode;
};

export type AgentToolDelegation = {
  toolName: string;
  args: unknown;
};

export type AgentToolDescriptor<TInput = unknown> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  executionPlane: AgentToolExecutionPlane;
  mutation: AgentToolMutationClass;
  risk?: AgentConfirmationCategory;
  riskForInput?: (input: TInput) => AgentConfirmationCategory | undefined;
  mutationBoundary?: "cms";
  blocksOnDirtyCms?: boolean;
  /** Returns the disk document that must not currently be open in Composer. */
  requiresClosedDocument?: (input: TInput) => string;
  delegate?: (input: TInput) => AgentToolDelegation;
  reversible: boolean;
  approvalPolicy: "never" | "always" | "conditional";
  externalSideEffect: boolean;
  outputLimit: number;
  availability?: (runtime: AgentToolRuntime) => boolean;
  confirmationSummary?: (input: unknown) => string;
  execute: (
    runtime: AgentToolRuntime,
    input: TInput,
  ) => Promise<AgentToolResult> | AgentToolResult;
};

type FinalizeToolDescriptorInput<TSchema extends z.ZodType> = Omit<
  AgentToolDescriptor<z.infer<TSchema>>,
  "outputLimit" | "reversible" | "approvalPolicy" | "externalSideEffect" | "inputSchema" | "execute"
> & {
  inputSchema: TSchema;
  execute: (
    runtime: AgentToolRuntime,
    input: z.infer<TSchema>,
  ) => Promise<AgentToolResult> | AgentToolResult;
  outputLimit?: number;
  reversible?: boolean;
  approvalPolicy?: "never" | "always" | "conditional";
  externalSideEffect?: boolean;
};

/**
 * Infers execute `input` from `inputSchema`, then widens to `AgentToolDescriptor`
 * so tools can sit in a homogeneous registry without contextual typing forcing `unknown`.
 */
export function finalizeToolDescriptor<TSchema extends z.ZodType>(
  value: FinalizeToolDescriptorInput<TSchema>,
): AgentToolDescriptor {
  return {
    outputLimit: value.mutation === "read" ? 48_000 : 24_000,
    reversible:
      value.reversible ??
      (value.mutation === "write" && value.risk !== "delete_content"),
    approvalPolicy:
      value.approvalPolicy ??
      (value.risk ? "always" : value.riskForInput ? "conditional" : "never"),
    externalSideEffect: value.externalSideEffect ?? false,
    ...value,
    execute: value.execute as AgentToolDescriptor["execute"],
  };
}
