import {
  InvalidToolInputError,
  NoSuchToolError,
  type ToolCallRepairFunction,
  type ToolSet,
} from "ai";

type MutableRecord = Record<string, unknown>;

function isRecord(value: unknown): value is MutableRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseToolInput(input: string): unknown {
  return input.trim() ? (JSON.parse(input) as unknown) : {};
}

function parseJsonEncodedValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;
  return JSON.parse(trimmed) as unknown;
}

function normalizeInsertNodesInput(input: unknown): MutableRecord | null {
  if (!isRecord(input)) return null;
  let nodes: unknown;
  try {
    nodes = parseJsonEncodedValue(input.nodes);
  } catch {
    return null;
  }
  if (!Array.isArray(nodes)) return null;
  const next: MutableRecord = { nodes };
  if (input.target !== undefined) next.target = input.target;
  if (input.parentPath !== undefined || input.index !== undefined) {
    next.target = {
      parentPath: typeof input.parentPath === "string" ? input.parentPath : null,
      index: Number(input.index ?? 0),
    };
  }
  return next;
}

function repairInsertToolCall(input: {
  toolCall: Parameters<ToolCallRepairFunction<ToolSet>>[0]["toolCall"];
  tools: ToolSet;
  error: Parameters<ToolCallRepairFunction<ToolSet>>[0]["error"];
}): ReturnType<ToolCallRepairFunction<ToolSet>> | null {
  const { error, toolCall, tools } = input;
  const isUnavailable = NoSuchToolError.isInstance(error);
  const isInvalid = InvalidToolInputError.isInstance(error);
  if (!isUnavailable && !isInvalid) return null;

  let parsedInput: unknown;
  try {
    parsedInput = parseToolInput(toolCall.input);
  } catch {
    return null;
  }

  if (toolCall.toolName === "aria_insert_nodes" && "insert_nodes" in tools) {
    const normalized = normalizeInsertNodesInput(parsedInput);
    if (!normalized) return null;
    return Promise.resolve({
      ...toolCall,
      toolName: "insert_nodes",
      input: JSON.stringify(normalized),
    });
  }

  if (toolCall.toolName === "insert_nodes") {
    const normalized = normalizeInsertNodesInput(parsedInput);
    if (!normalized) return null;
    return Promise.resolve({
      ...toolCall,
      input: JSON.stringify(normalized),
    });
  }

  if (
    toolCall.toolName === "update_node_motion" &&
    "aria_update_node_motion" in tools &&
    isRecord(parsedInput)
  ) {
    return Promise.resolve({
      ...toolCall,
      toolName: "aria_update_node_motion",
      input: JSON.stringify({
        path: parsedInput.path,
        blockId: parsedInput.blockId ?? parsedInput.nodeId,
        motion: parsedInput.motion,
      }),
    });
  }

  if (
    toolCall.toolName === "aria_update_node_motion" &&
    "update_node_motion" in tools &&
    isRecord(parsedInput)
  ) {
    return Promise.resolve({
      ...toolCall,
      toolName: "update_node_motion",
      input: JSON.stringify({
        path: parsedInput.path,
        blockId: parsedInput.blockId ?? parsedInput.nodeId,
        motion: parsedInput.motion,
      }),
    });
  }

  if (toolCall.toolName === "insert_designed_section" && isRecord(parsedInput)) {
    let node: unknown;
    try {
      node = parseJsonEncodedValue(parsedInput.node);
    } catch {
      return null;
    }
    return Promise.resolve({
      ...toolCall,
      input: JSON.stringify({ ...parsedInput, node }),
    });
  }

  return null;
}

/**
 * Repair compacted / aliased Aria tool calls for the desktop direct profile.
 * Maps unavailable aria_* canvas aliases onto live tools or aria_execute_command.
 */
export const repairCompactedAriaToolCall: ToolCallRepairFunction<ToolSet> =
  async ({ error, toolCall, tools }) => {
    const repairedInsert = repairInsertToolCall({ error, toolCall, tools });
    if (repairedInsert) return repairedInsert;

    if (
      !NoSuchToolError.isInstance(error) ||
      !toolCall.toolName.startsWith("aria_") ||
      toolCall.toolName === "aria_execute_command" ||
      !("aria_execute_command" in tools)
    ) {
      return null;
    }

    let input: unknown;
    try {
      input = parseToolInput(toolCall.input);
    } catch {
      return null;
    }

    return {
      ...toolCall,
      toolName: "aria_execute_command",
      input: JSON.stringify({
        command: toolCall.toolName,
        input,
      }),
    };
  };
