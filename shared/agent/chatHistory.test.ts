import { describe, expect, it } from "vitest";
import {
  AGENT_MAX_CONVERSATIONS,
  DEFAULT_AGENT_CONVERSATION_TITLE,
  conversationTitleFromMessages,
  deleteConversationFromStore,
  parseLocalChatHistory,
  upsertActiveConversation,
  type AgentChatMessage,
  type AgentConversation,
} from "./index";

function message(
  role: AgentChatMessage["role"],
  content: string,
  createdAt = "2026-01-01T00:00:00.000Z",
): AgentChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt,
  };
}

function conversation(
  patch: Partial<AgentConversation> & Pick<AgentConversation, "id">,
): AgentConversation {
  return {
    title: DEFAULT_AGENT_CONVERSATION_TITLE,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [message("user", "Hello")],
    ...patch,
  };
}

describe("conversationTitleFromMessages", () => {
  it("uses the first user message and truncates long titles", () => {
    expect(conversationTitleFromMessages([])).toBe(
      DEFAULT_AGENT_CONVERSATION_TITLE,
    );
    expect(
      conversationTitleFromMessages([
        message("assistant", "Hi"),
        message("user", "  Suggest a hero   for this page "),
      ]),
    ).toBe("Suggest a hero for this page");

    const long = "a".repeat(80);
    const title = conversationTitleFromMessages([message("user", long)]);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBe(60);
  });
});

describe("parseLocalChatHistory", () => {
  it("migrates a v1 thread into one conversation", () => {
    const messages = [
      message("user", "Audit this page's SEO", "2026-02-01T10:00:00.000Z"),
      message("assistant", "Done.", "2026-02-01T10:00:05.000Z"),
    ];
    const store = parseLocalChatHistory({ version: 1, messages });
    expect(store.version).toBe(2);
    expect(store.conversations).toHaveLength(1);
    expect(store.conversations[0]).toMatchObject({
      title: "Audit this page's SEO",
      createdAt: "2026-02-01T10:00:00.000Z",
      updatedAt: "2026-02-01T10:00:05.000Z",
      messages,
    });
    expect(store.activeId).toBe(store.conversations[0]!.id);
  });

  it("migrates an empty v1 thread to an empty store", () => {
    const store = parseLocalChatHistory({ version: 1, messages: [] });
    expect(store.conversations).toEqual([]);
  });
});

describe("upsertActiveConversation", () => {
  it("does not persist an empty draft", () => {
    const existing = conversation({
      id: "kept",
      title: "Kept chat",
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    const store = upsertActiveConversation(
      {
        version: 2,
        activeId: "draft",
        conversations: [existing],
      },
      "draft",
      [],
    );
    expect(store.conversations.map((item) => item.id)).toEqual(["kept"]);
    expect(store.activeId).toBe("draft");
  });

  it("sets the title once from the first user turn", () => {
    const first = upsertActiveConversation(
      { version: 2, activeId: "c1", conversations: [] },
      "c1",
      [message("user", "Improve copy on this page")],
      "2026-04-01T00:00:00.000Z",
    );
    expect(first.conversations[0]?.title).toBe("Improve copy on this page");

    const second = upsertActiveConversation(
      first,
      "c1",
      [
        message("user", "Improve copy on this page"),
        message("assistant", "Updated."),
        message("user", "Make the headline shorter"),
      ],
      "2026-04-01T00:01:00.000Z",
    );
    expect(second.conversations[0]?.title).toBe("Improve copy on this page");
  });

  it("caps stored conversations", () => {
    const conversations = Array.from(
      { length: AGENT_MAX_CONVERSATIONS },
      (_, index) =>
        conversation({
          id: `c${index}`,
          title: `Chat ${index}`,
          updatedAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
        }),
    );
    const store = upsertActiveConversation(
      { version: 2, activeId: "newest", conversations },
      "newest",
      [message("user", "Newest")],
      "2026-12-01T00:00:00.000Z",
    );
    expect(store.conversations).toHaveLength(AGENT_MAX_CONVERSATIONS);
    expect(store.conversations[0]?.id).toBe("newest");
    expect(store.conversations.some((item) => item.id === "c0")).toBe(false);
  });
});

describe("deleteConversationFromStore", () => {
  it("falls back to the most recent remaining conversation", () => {
    const store = deleteConversationFromStore(
      {
        version: 2,
        activeId: "a",
        conversations: [
          conversation({
            id: "a",
            title: "Active",
            updatedAt: "2026-05-02T00:00:00.000Z",
          }),
          conversation({
            id: "b",
            title: "Older",
            updatedAt: "2026-05-01T00:00:00.000Z",
          }),
        ],
      },
      "a",
    );
    expect(store.conversations.map((item) => item.id)).toEqual(["b"]);
    expect(store.activeId).toBe("b");
  });
});
