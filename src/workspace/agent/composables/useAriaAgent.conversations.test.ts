// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  resetAriaAgentControllersForTests,
  useAriaAgent,
} from "./useAriaAgent";
import { readLocalChatStore } from "./useLocalChatHistory";
import type { AgentChatMessage } from "../../../../shared/agent";

function message(
  content: string,
  createdAt = "2026-07-01T00:00:00.000Z",
): AgentChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt,
  };
}

afterEach(() => {
  resetAriaAgentControllersForTests();
  localStorage.clear();
});

describe("useAriaAgent conversations", () => {
  it("archives the current thread on create and leaves empty drafts unstored", () => {
    const projectPath = "/tmp/aria-agent-create";
    localStorage.setItem(
      `aria-engineer-chat-history:${projectPath}`,
      JSON.stringify({
        version: 2,
        activeId: "first",
        conversations: [
          {
            id: "first",
            title: "First chat",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages: [message("First chat")],
          },
        ],
      }),
    );

    const agent = useAriaAgent(() => projectPath);
    expect(agent.messages.value).toHaveLength(1);

    agent.createConversation();
    expect(agent.messages.value).toEqual([]);
    expect(agent.conversations.value).toHaveLength(1);
    expect(agent.conversations.value[0]?.id).toBe("first");
    expect(agent.activeId.value).not.toBe("first");

    const stored = readLocalChatStore(projectPath);
    expect(stored.conversations.map((item) => item.id)).toEqual(["first"]);
    expect(stored.activeId).toBe(agent.activeId.value);

    agent.createConversation();
    expect(agent.messages.value).toEqual([]);
    expect(agent.conversations.value).toHaveLength(1);
  });

  it("selects and deletes conversations", () => {
    const projectPath = "/tmp/aria-agent-select";
    localStorage.setItem(
      `aria-engineer-chat-history:${projectPath}`,
      JSON.stringify({
        version: 2,
        activeId: "alpha",
        conversations: [
          {
            id: "alpha",
            title: "Alpha",
            createdAt: "2026-07-02T00:00:00.000Z",
            updatedAt: "2026-07-02T01:00:00.000Z",
            messages: [message("Alpha")],
          },
          {
            id: "beta",
            title: "Beta",
            createdAt: "2026-07-02T00:00:00.000Z",
            updatedAt: "2026-07-02T00:00:00.000Z",
            messages: [message("Beta")],
          },
        ],
      }),
    );

    const agent = useAriaAgent(() => projectPath);
    expect(agent.messages.value[0]?.content).toBe("Alpha");

    agent.selectConversation("beta");
    expect(agent.activeId.value).toBe("beta");
    expect(agent.messages.value[0]?.content).toBe("Beta");

    agent.deleteConversation("beta");
    expect(agent.activeId.value).toBe("alpha");
    expect(agent.messages.value[0]?.content).toBe("Alpha");
    expect(agent.conversations.value.map((item) => item.id)).toEqual(["alpha"]);
  });
});
