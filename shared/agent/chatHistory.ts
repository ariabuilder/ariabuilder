import {
  AGENT_CONVERSATION_TITLE_MAX,
  AGENT_MAX_CONVERSATIONS,
  AGENT_MAX_MESSAGES,
  DEFAULT_AGENT_CONVERSATION_TITLE,
} from "./constants";
import {
  LocalChatHistorySchema,
  LocalChatHistoryV1Schema,
  type AgentChatMessage,
  type AgentConversation,
  type LocalChatHistory,
} from "./chat";

export function conversationTitleFromMessages(
  messages: readonly AgentChatMessage[],
): string {
  const firstUser = messages.find(
    (message) => message.role === "user" && message.content.trim().length > 0,
  );
  if (!firstUser) return DEFAULT_AGENT_CONVERSATION_TITLE;
  const text = firstUser.content.trim().replace(/\s+/g, " ");
  if (text.length <= AGENT_CONVERSATION_TITLE_MAX) return text;
  return `${text.slice(0, AGENT_CONVERSATION_TITLE_MAX - 1).trimEnd()}…`;
}

export function emptyChatStore(
  activeId = crypto.randomUUID(),
): LocalChatHistory {
  return {
    version: 2,
    activeId,
    conversations: [],
  };
}

function sortConversations(
  conversations: readonly AgentConversation[],
): AgentConversation[] {
  return [...conversations].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
}

function pruneConversations(
  conversations: readonly AgentConversation[],
): AgentConversation[] {
  return sortConversations(conversations)
    .filter((conversation) => conversation.messages.length > 0)
    .slice(0, AGENT_MAX_CONVERSATIONS)
    .map((conversation) => ({
      ...conversation,
      messages: conversation.messages.slice(-AGENT_MAX_MESSAGES),
      title:
        conversation.title === DEFAULT_AGENT_CONVERSATION_TITLE
          ? conversationTitleFromMessages(conversation.messages)
          : conversation.title,
    }));
}

function migrateV1(history: {
  messages: AgentChatMessage[];
}): LocalChatHistory {
  if (history.messages.length === 0) return emptyChatStore();
  const createdAt = history.messages[0]?.createdAt ?? new Date().toISOString();
  const updatedAt =
    history.messages[history.messages.length - 1]?.createdAt ?? createdAt;
  const id = crypto.randomUUID();
  return {
    version: 2,
    activeId: id,
    conversations: pruneConversations([
      {
        id,
        title: conversationTitleFromMessages(history.messages),
        createdAt,
        updatedAt,
        messages: history.messages,
      },
    ]),
  };
}

export function normalizeChatStore(store: LocalChatHistory): LocalChatHistory {
  return {
    version: 2,
    activeId: store.activeId,
    conversations: pruneConversations(store.conversations),
  };
}

export function parseLocalChatHistory(input: unknown): LocalChatHistory {
  const v2 = LocalChatHistorySchema.safeParse(input);
  if (v2.success) return normalizeChatStore(v2.data);
  const v1 = LocalChatHistoryV1Schema.safeParse(input);
  if (v1.success) return migrateV1(v1.data);
  return emptyChatStore();
}

export function upsertActiveConversation(
  store: LocalChatHistory,
  activeId: string,
  messages: readonly AgentChatMessage[],
  now = new Date().toISOString(),
): LocalChatHistory {
  if (messages.length === 0) {
    return {
      version: 2,
      activeId,
      conversations: pruneConversations(
        store.conversations.filter((conversation) => conversation.id !== activeId),
      ),
    };
  }

  const existing = store.conversations.find(
    (conversation) => conversation.id === activeId,
  );
  const next: AgentConversation = {
    id: activeId,
    title:
      existing && existing.title !== DEFAULT_AGENT_CONVERSATION_TITLE
        ? existing.title
        : conversationTitleFromMessages(messages),
    createdAt: existing?.createdAt ?? messages[0]?.createdAt ?? now,
    updatedAt: now,
    messages: messages.slice(-AGENT_MAX_MESSAGES),
  };

  return normalizeChatStore({
    version: 2,
    activeId,
    conversations: [
      next,
      ...store.conversations.filter((conversation) => conversation.id !== activeId),
    ],
  });
}

export function deleteConversationFromStore(
  store: LocalChatHistory,
  conversationId: string,
): LocalChatHistory {
  const conversations = pruneConversations(
    store.conversations.filter(
      (conversation) => conversation.id !== conversationId,
    ),
  );
  const activeId =
    store.activeId === conversationId
      ? (conversations[0]?.id ?? crypto.randomUUID())
      : store.activeId;
  return {
    version: 2,
    activeId,
    conversations,
  };
}

export function conversationSummaries(store: LocalChatHistory) {
  return store.conversations.map((conversation) => ({
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  }));
}
