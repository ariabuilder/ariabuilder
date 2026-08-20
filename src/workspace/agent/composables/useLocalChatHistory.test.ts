// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  readLocalChatHistory,
  readLocalChatStore,
  writeLocalChatHistory,
} from "./useLocalChatHistory";
import type { AgentChatMessage } from "../../../../shared/agent";

const projectPath = "/tmp/aria-history-store";

function message(
  content: string,
  createdAt = "2026-06-01T12:00:00.000Z",
): AgentChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "user",
    content,
    createdAt,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("useLocalChatHistory store", () => {
  it("migrates a v1 localStorage blob", () => {
    const messages = [message("Suggest a hero for this page")];
    localStorage.setItem(
      `aria-engineer-chat-history:${projectPath}`,
      JSON.stringify({ version: 1, messages }),
    );

    const store = readLocalChatStore(projectPath);
    expect(store.version).toBe(2);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]?.title).toBe("Suggest a hero for this page");
    expect(readLocalChatHistory(projectPath)).toEqual(messages);
  });

  it("writes the active conversation without storing empty drafts", () => {
    const archived = writeLocalChatHistory(projectPath, "kept", [
      message("Kept chat"),
    ]);
    expect(archived.conversations).toHaveLength(1);

    const draft = writeLocalChatHistory(projectPath, "draft", []);
    expect(draft.activeId).toBe("draft");
    expect(draft.conversations).toHaveLength(1);
    expect(draft.conversations[0]?.id).toBe("kept");
    expect(readLocalChatHistory(projectPath)).toEqual([]);
  });
});
