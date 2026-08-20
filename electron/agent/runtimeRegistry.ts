import { asSchema } from "@ai-sdk/provider-utils";
import type { AgentToolDescriptor, AgentToolRuntime } from "./toolRegistry";

export type RuntimeCapabilitySummary = {
  command: string;
  description: string;
  mutation: AgentToolDescriptor["mutation"];
  executionPlane: AgentToolDescriptor["executionPlane"];
  risk: AgentToolDescriptor["risk"] | null;
  reversible: boolean;
  approvalPolicy: AgentToolDescriptor["approvalPolicy"];
};

export type RuntimeCapabilityDescription = RuntimeCapabilitySummary & {
  inputSchema: unknown;
  externalSideEffect: boolean;
};

export function listAvailableToolDescriptors(
  descriptors: readonly AgentToolDescriptor[],
  runtime: AgentToolRuntime,
  composerMode: "ask" | "agent",
): AgentToolDescriptor[] {
  return descriptors.filter((descriptor) => {
    if (composerMode === "ask" && descriptor.mutation === "write") return false;
    if (descriptor.availability && !descriptor.availability(runtime)) return false;
    return true;
  });
}

export function searchAvailableCommands(input: {
  descriptors: readonly AgentToolDescriptor[];
  runtime: AgentToolRuntime;
  composerMode: "ask" | "agent";
  query: string;
  limit: number;
}): RuntimeCapabilitySummary[] {
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  return listAvailableToolDescriptors(
    input.descriptors,
    input.runtime,
    input.composerMode,
  )
    .map((descriptor) => {
      const text = `${descriptor.name} ${descriptor.description}`.toLowerCase();
      const score = terms.reduce(
        (total, term) => total + (text.includes(term) ? 1 : 0),
        0,
      );
      return { descriptor, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.descriptor.name.localeCompare(right.descriptor.name),
    )
    .slice(0, input.limit)
    .map(({ descriptor }) => summarizeDescriptor(descriptor));
}

export function summarizeDescriptor(
  descriptor: AgentToolDescriptor,
): RuntimeCapabilitySummary {
  return {
    command: descriptor.name,
    description: descriptor.description,
    mutation: descriptor.mutation,
    executionPlane: descriptor.executionPlane,
    risk: descriptor.risk ?? null,
    reversible: descriptor.reversible,
    approvalPolicy: descriptor.approvalPolicy,
  };
}

export async function describeAvailableCommand(input: {
  descriptors: readonly AgentToolDescriptor[];
  runtime: AgentToolRuntime;
  composerMode: "ask" | "agent";
  name: string;
}): Promise<RuntimeCapabilityDescription | null> {
  const available = listAvailableToolDescriptors(
    input.descriptors,
    input.runtime,
    input.composerMode,
  );
  const descriptor = available.find((entry) => entry.name === input.name);
  if (!descriptor) return null;
  const schema = await asSchema(descriptor.inputSchema).jsonSchema;
  return {
    ...summarizeDescriptor(descriptor),
    inputSchema: schema,
    externalSideEffect: descriptor.externalSideEffect,
  };
}

/**
 * Design OS direct profile: site + design read + authoring catalogs + command discovery trio.
 * Canvas tools are added separately. Keep DESKTOP + LIVE ≤ 22.
 */
export const DESKTOP_DIRECT_TOOL_NAMES = [
  "aria_get_site_context",
  "aria_get_design_system",
  "aria_list_element_types",
  "aria_get_node_capabilities",
  "aria_search_commands",
  "aria_describe_command",
  "aria_execute_command",
] as const;

/** Live Composer canvas tools — always in the direct set for open→insert same turn. */
export const LIVE_COMPOSER_DIRECT_TOOL_NAMES = [
  "open_in_composer",
  "select_block",
  "insert_nodes",
  "insert_designed_section",
  "aria_mutate_node",
  "aria_update_node_classes",
  "aria_update_node_motion",
  "aria_attach_media_to_node",
  "aria_replace_node",
  "aria_move_node",
  "aria_delete_node",
  "aria_get_node_condition",
  "aria_set_node_condition",
  "aria_remove_node_condition",
] as const;

/**
 * Server-style document mutators that must not sit beside live canvas tools
 * (models otherwise cycle aliases after one schema failure).
 */
export const LIVE_COMPOSER_HIDDEN_ALIASES = [
  "aria_insert_nodes",
  "update_node_motion",
] as const;

export function isLiveComposerActive(runtime: AgentToolRuntime): boolean {
  return Boolean(
    runtime.rendererCapabilities?.document &&
      runtime.shellContext?.documentContext?.editable,
  );
}

export function selectDirectToolNames(runtime: AgentToolRuntime): Set<string> {
  const names = new Set<string>(DESKTOP_DIRECT_TOOL_NAMES);
  for (const name of LIVE_COMPOSER_DIRECT_TOOL_NAMES) names.add(name);
  for (const name of LIVE_COMPOSER_HIDDEN_ALIASES) names.delete(name);
  names.delete("aria_insert_nodes");
  void runtime;
  return names;
}
