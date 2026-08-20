import { onMounted, ref } from "vue";
import {
  emptyChatStore,
  parseLocalChatHistory,
  upsertActiveConversation,
  type AgentChatMessage,
  type LocalChatHistory,
} from "../../../../shared/agent";

function storageKey(projectPath: string): string {
  return `aria-engineer-chat-history:${projectPath}`;
}

export function readLocalChatStore(projectPath: string): LocalChatHistory {
  try {
    const raw = localStorage.getItem(storageKey(projectPath));
    if (!raw) return emptyChatStore();
    return parseLocalChatHistory(JSON.parse(raw));
  } catch {
    localStorage.removeItem(storageKey(projectPath));
    return emptyChatStore();
  }
}

export function writeLocalChatStore(
  projectPath: string,
  store: LocalChatHistory,
): LocalChatHistory {
  const normalized = parseLocalChatHistory(store);
  localStorage.setItem(storageKey(projectPath), JSON.stringify(normalized));
  return normalized;
}

export function readLocalChatHistory(projectPath: string): AgentChatMessage[] {
  const store = readLocalChatStore(projectPath);
  return (
    store.conversations.find(
      (conversation) => conversation.id === store.activeId,
    )?.messages ?? []
  );
}

export function writeLocalChatHistory(
  projectPath: string,
  activeId: string,
  messages: readonly AgentChatMessage[],
): LocalChatHistory {
  return writeLocalChatStore(
    projectPath,
    upsertActiveConversation(
      readLocalChatStore(projectPath),
      activeId,
      messages,
    ),
  );
}

export function clearLocalChatHistory(projectPath: string): void {
  localStorage.removeItem(storageKey(projectPath));
}

export function useLocalChatHistory(projectPath: () => string) {
  const store = ref<LocalChatHistory>(emptyChatStore());
  const messages = ref<AgentChatMessage[]>([]);

  function load() {
    store.value = readLocalChatStore(projectPath());
    messages.value =
      store.value.conversations.find(
        (conversation) => conversation.id === store.value.activeId,
      )?.messages ?? [];
  }

  function persist() {
    store.value = writeLocalChatHistory(
      projectPath(),
      store.value.activeId,
      messages.value,
    );
  }

  function clear() {
    clearLocalChatHistory(projectPath());
    store.value = emptyChatStore();
    messages.value = [];
  }

  onMounted(load);

  return { store, messages, load, persist, clear };
}
