import type { InferenceBackendId, ProviderInstance } from "./settings";

export function defaultOpencodeModel(): string {
  return "opencode/claude-sonnet-4";
}

export interface InferenceBackendDefinition {
  id: InferenceBackendId;
  label: string;
  description: string;
  requiresCredentials: boolean;
  defaultModelId: string;
  seedModelIds: readonly string[];
  sortOrder: number;
  keyUrl?: string;
}

export const INFERENCE_BACKEND_DEFINITIONS: readonly InferenceBackendDefinition[] =
  [
    {
      id: "opencode",
      label: "OpenCode",
      description: "OpenCode Zen and Go models via your API key.",
      requiresCredentials: true,
      defaultModelId: defaultOpencodeModel(),
      seedModelIds: [defaultOpencodeModel()],
      sortOrder: 1,
      keyUrl: "https://opencode.ai",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      description: "Route to 300+ models with your OpenRouter API key.",
      requiresCredentials: true,
      defaultModelId: "openai/gpt-4o-mini",
      seedModelIds: [
        "openai/gpt-4o-mini",
        "anthropic/claude-sonnet-4",
        "google/gemini-2.5-flash-preview",
      ],
      sortOrder: 2,
      keyUrl: "https://openrouter.ai/keys",
    },
    {
      id: "openai",
      label: "OpenAI",
      description: "OpenAI models with your API key.",
      requiresCredentials: true,
      defaultModelId: "gpt-4.1-mini",
      seedModelIds: ["gpt-4.1-mini", "gpt-4.1", "gpt-4o-mini"],
      sortOrder: 3,
      keyUrl: "https://platform.openai.com/api-keys",
    },
    {
      id: "anthropic",
      label: "Anthropic",
      description: "Claude models with your Anthropic API key.",
      requiresCredentials: true,
      defaultModelId: "claude-sonnet-4-20250514",
      seedModelIds: ["claude-sonnet-4-20250514"],
      sortOrder: 4,
      keyUrl: "https://console.anthropic.com/settings/keys",
    },
    {
      id: "google",
      label: "Google AI",
      description: "Gemini models with your Google AI API key.",
      requiresCredentials: true,
      defaultModelId: "gemini-2.5-flash",
      seedModelIds: ["gemini-2.5-flash"],
      sortOrder: 5,
      keyUrl: "https://aistudio.google.com/app/apikey",
    },
    {
      id: "openai_compatible",
      label: "OpenAI-compatible",
      description:
        "Any OpenAI-compatible endpoint with your API key and base URL.",
      requiresCredentials: true,
      defaultModelId: "",
      seedModelIds: [],
      sortOrder: 6,
    },
  ] as const;

export function getInferenceBackendDefinition(
  id: InferenceBackendId,
): InferenceBackendDefinition {
  const match = INFERENCE_BACKEND_DEFINITIONS.find(
    (provider) => provider.id === id,
  );
  if (!match) {
    throw new Error(`Unknown inference backend: ${id}`);
  }
  return match;
}

export function buildInitialProviderInstance(
  backendId: InferenceBackendId,
  label: string,
): ProviderInstance {
  const definition = getInferenceBackendDefinition(backendId);
  const seedIds = definition.seedModelIds.filter(Boolean);
  const defaultModelId = definition.defaultModelId || seedIds[0] || "";
  const enabledModelIds =
    seedIds.length > 0 ? [...seedIds] : defaultModelId ? [defaultModelId] : [];

  return {
    id: crypto.randomUUID(),
    backend: backendId,
    label,
    enabled: true,
    defaultModelId,
    enabledModelIds,
    disabledModelIds: [],
    route: { type: "direct" },
  };
}
