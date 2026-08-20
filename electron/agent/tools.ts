import { tool, type ToolSet } from "ai";
import type { AgentComposerMode, AgentWorkspace } from "../../shared/agent";
import {
  isLiveComposerActive,
  selectDirectToolNames,
} from "./runtimeRegistry";
import {
  agentToolNeedsApproval,
  invokeAgentTool,
  listAgentToolDescriptors,
  type AgentToolRuntime,
} from "./toolRegistry";

export type ToolRuntimeDeps = AgentToolRuntime;

function workspacePriority(
  workspace: AgentWorkspace | undefined,
  name: string,
): number {
  if (workspace === "composer") {
    if (
      name === "open_in_composer" ||
      name === "select_block" ||
      name.includes("node") ||
      name.includes("insert")
    ) {
      return 0;
    }
  }
  if (
    name === "aria_get_site_context" ||
    name === "aria_get_design_system" ||
    name.includes("capabilit") ||
    name.includes("element_types")
  ) {
    return 1;
  }
  if (
    name === "aria_search_commands" ||
    name === "aria_describe_command" ||
    name === "aria_execute_command"
  ) {
    return 2;
  }
  if (workspace === "composer") {
    if (
      name.includes("design") ||
      name.includes("media") ||
      name.includes("page") ||
      name.includes("component")
    ) {
      return 3;
    }
  }
  if (workspace === "collections") {
    if (
      name.includes("entry") ||
      name.includes("collection") ||
      name.includes("cms") ||
      name.includes("markdown") ||
      name === "aria_setup_blog"
    ) {
      return 1;
    }
  }
  if (workspace === "design") {
    if (
      name.includes("design") ||
      name.includes("class") ||
      name.includes("font") ||
      name.includes("media")
    ) {
      return 1;
    }
  }
  if (workspace === "studio") {
    if (
      name.includes("page") ||
      name.includes("component") ||
      name.includes("layout") ||
      name.includes("media")
    ) {
      return 1;
    }
  }
  return 3;
}

/**
 * Build the model-visible tool set: a compact Design OS direct profile (≤22)
 * plus search → describe → execute for the remainder of available capabilities.
 */
export function buildDesktopAiTools(input: {
  deps: ToolRuntimeDeps;
  composerMode: AgentComposerMode;
}): ToolSet {
  const tools: ToolSet = {};
  const directNames = selectDirectToolNames(input.deps);
  const descriptors = listAgentToolDescriptors().sort(
    (left, right) =>
      workspacePriority(input.deps.shellContext?.workspace, left.name) -
        workspacePriority(input.deps.shellContext?.workspace, right.name) ||
      left.name.localeCompare(right.name),
  );

  for (const descriptor of descriptors) {
    if (input.composerMode === "ask" && descriptor.mutation === "write") continue;
    if (descriptor.availability && !descriptor.availability(input.deps)) continue;
    if (!directNames.has(descriptor.name)) continue;
    if (
      isLiveComposerActive(input.deps) &&
      descriptor.name === "aria_insert_nodes"
    ) {
      continue;
    }

    tools[descriptor.name] = tool({
      description: descriptor.description,
      inputSchema: descriptor.inputSchema,
      needsApproval: (args) => agentToolNeedsApproval(descriptor.name, args),
      execute: async (args) =>
        invokeAgentTool({
          runtime: input.deps,
          composerMode: input.composerMode,
          toolName: descriptor.name,
          args,
          approvedBySdk: agentToolNeedsApproval(descriptor.name, args),
        }),
    });
  }
  return tools;
}
