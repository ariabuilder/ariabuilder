import { InvalidToolInputError, NoSuchToolError } from "ai";
import { describe, expect, it } from "vitest";
import { repairCompactedAriaToolCall } from "./toolCallRepair";

describe("repairCompactedAriaToolCall", () => {
  it("rewrites aria_insert_nodes to insert_nodes when the live tool exists", async () => {
    const repaired = await repairCompactedAriaToolCall({
      toolCall: {
        type: "tool-call",
        toolCallId: "1",
        toolName: "aria_insert_nodes",
        input: JSON.stringify({
          nodes: JSON.stringify([{ primitive: "section" }]),
          target: { parentPath: "1.1.0", index: 2 },
        }),
      },
      tools: {
        insert_nodes: {} as never,
        aria_execute_command: {} as never,
      },
      inputSchema: {} as never,
      error: new NoSuchToolError({ toolName: "aria_insert_nodes", availableTools: ["insert_nodes"] }),
      messages: [],
      instructions: undefined,
      system: undefined,
    });
    expect(repaired?.toolName).toBe("insert_nodes");
    expect(JSON.parse(String(repaired?.input))).toEqual({
      nodes: [{ primitive: "section" }],
      target: { parentPath: "1.1.0", index: 2 },
    });
  });

  it("wraps compacted aria_* calls into aria_execute_command", async () => {
    const repaired = await repairCompactedAriaToolCall({
      toolCall: {
        type: "tool-call",
        toolCallId: "2",
        toolName: "aria_list_media",
        input: JSON.stringify({}),
      },
      tools: {
        aria_execute_command: {} as never,
      },
      inputSchema: {} as never,
      error: new NoSuchToolError({
        toolName: "aria_list_media",
        availableTools: ["aria_execute_command"],
      }),
      messages: [],
      instructions: undefined,
      system: undefined,
    });
    expect(repaired?.toolName).toBe("aria_execute_command");
    expect(JSON.parse(String(repaired?.input))).toEqual({
      command: "aria_list_media",
      input: {},
    });
  });

  it("unwraps stringified insert_designed_section nodes", async () => {
    const repaired = await repairCompactedAriaToolCall({
      toolCall: {
        type: "tool-call",
        toolCallId: "3",
        toolName: "insert_designed_section",
        input: JSON.stringify({
          node: JSON.stringify({ primitive: "section" }),
        }),
      },
      tools: {
        insert_designed_section: {} as never,
      },
      inputSchema: {} as never,
      error: new InvalidToolInputError({
        toolName: "insert_designed_section",
        toolInput: "{}",
        cause: new Error("invalid"),
      }),
      messages: [],
      instructions: undefined,
      system: undefined,
    });
    expect(repaired?.toolName).toBe("insert_designed_section");
    expect(JSON.parse(String(repaired?.input))).toEqual({
      node: { primitive: "section" },
    });
  });
});
