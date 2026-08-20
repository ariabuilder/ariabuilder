import { ref, watch, type Ref } from "vue";
import {
  DEFAULT_AGENT_SESSION_PREFS,
  parseAgentSessionPrefs,
  type AgentSessionPrefs,
} from "../../../../shared/agent";

const STORAGE_KEY = "aria-engineer-session-prefs";
type SessionPrefsController = {
  prefs: Ref<AgentSessionPrefs>;
  updatePrefs: (patch: Partial<AgentSessionPrefs>) => void;
};

const controllers = new Map<string, SessionPrefsController>();

function storageKey(projectPath: string): string {
  return `${STORAGE_KEY}:${projectPath}`;
}

function readPrefs(projectPath: string): AgentSessionPrefs {
  try {
    const raw =
      localStorage.getItem(storageKey(projectPath)) ??
      // One-time compatibility with the original global session preference.
      localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AGENT_SESSION_PREFS };
    return parseAgentSessionPrefs(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AGENT_SESSION_PREFS };
  }
}

function createController(projectPath: string): SessionPrefsController {
  const prefs = ref<AgentSessionPrefs>(readPrefs(projectPath));
  watch(
    prefs,
    (value) => {
      localStorage.setItem(storageKey(projectPath), JSON.stringify(value));
    },
    { deep: true },
  );

  function updatePrefs(patch: Partial<AgentSessionPrefs>) {
    prefs.value = parseAgentSessionPrefs({ ...prefs.value, ...patch });
  }

  return { prefs, updatePrefs };
}

export function useAgentSessionPrefs(projectPath: string) {
  const key = projectPath.trim();
  const existing = controllers.get(key);
  if (existing) return existing;
  const controller = createController(key);
  controllers.set(key, controller);
  return controller;
}
