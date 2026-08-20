import { z } from "zod";
import { AgentToolResultSchema } from "./toolProtocol";

export const AgentRendererHostScopeSchema = z.enum(["workspace", "document"]);
export type AgentRendererHostScope = z.infer<
  typeof AgentRendererHostScopeSchema
>;

export const AgentRendererHostRegistrationSchema = z
  .object({
    projectPath: z.string().min(1),
    scope: AgentRendererHostScopeSchema,
    registrationId: z.string().uuid(),
    active: z.boolean(),
  })
  .strict();
export type AgentRendererHostRegistration = z.infer<
  typeof AgentRendererHostRegistrationSchema
>;

export type ParsedAgentRendererHostRegistration =
  | { kind: "scoped"; registration: AgentRendererHostRegistration }
  | { kind: "legacy"; projectPath: string; active: boolean };

/**
 * Accept both the current scoped lease contract and the former positional
 * contract. Electron can hot-reload the renderer without restarting main or
 * preload, so this compatibility boundary prevents a mixed-version window
 * from silently losing its Composer host registration.
 */
export function parseAgentRendererHostRegistrationArgs(
  projectPathOrInput: unknown,
  active?: unknown,
  scope?: unknown,
  registrationId?: unknown,
): ParsedAgentRendererHostRegistration {
  if (
    projectPathOrInput &&
    typeof projectPathOrInput === "object" &&
    !Array.isArray(projectPathOrInput)
  ) {
    return {
      kind: "scoped",
      registration: AgentRendererHostRegistrationSchema.parse(projectPathOrInput),
    };
  }
  const projectPath = z.string().min(1).parse(projectPathOrInput);
  const isActive = z.boolean().parse(active);
  if (scope === undefined && registrationId === undefined) {
    return { kind: "legacy", projectPath, active: isActive };
  }
  return {
    kind: "scoped",
    registration: AgentRendererHostRegistrationSchema.parse({
      projectPath,
      active: isActive,
      scope,
      registrationId,
    }),
  };
}

export const AgentRendererToolRequestSchema = z
  .object({
    requestId: z.string().uuid(),
    projectPath: z.string().min(1),
    toolName: z.string().min(1),
    args: z.unknown(),
  })
  .strict();
export type AgentRendererToolRequest = z.infer<
  typeof AgentRendererToolRequestSchema
>;

export const AgentRendererToolResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    projectPath: z.string().min(1),
    result: AgentToolResultSchema,
  })
  .strict();
export type AgentRendererToolResponse = z.infer<
  typeof AgentRendererToolResponseSchema
>;
