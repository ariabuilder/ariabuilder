import type { CatalogModel, OpencodePlan } from "../../shared/agent";

export const OPENCODE_ZEN_BASE_URL = "https://opencode.ai/zen/v1" as const;
export const OPENCODE_GO_BASE_URL = "https://opencode.ai/zen/go/v1" as const;
export const OPENROUTER_API_BASE = "https://openrouter.ai/api/v1" as const;

export type OpencodeTransport =
  | "openai-responses"
  | "openai-compatible"
  | "anthropic-messages"
  | "google-generative-ai";

export function opencodePlanFromModelId(modelId: string): OpencodePlan {
  return modelId.trim().startsWith("opencode-go/") ? "go" : "zen";
}

export function getOpencodeBaseUrlForPlan(plan: OpencodePlan): string {
  return plan === "go" ? OPENCODE_GO_BASE_URL : OPENCODE_ZEN_BASE_URL;
}

export function stripOpencodeModelPrefix(modelId: string): string {
  return modelId.replace(/^opencode-go\//, "").replace(/^opencode\//, "");
}

export function getOpencodeTransport(modelId: string): OpencodeTransport {
  const plan = opencodePlanFromModelId(modelId);
  const bare = stripOpencodeModelPrefix(modelId).toLowerCase();

  if (plan === "zen") {
    if (bare.startsWith("gpt-")) return "openai-responses";
    if (bare.startsWith("claude-") || bare.startsWith("qwen")) {
      return "anthropic-messages";
    }
    if (bare.startsWith("gemini-")) return "google-generative-ai";
    return "openai-compatible";
  }

  if (bare.startsWith("minimax-") || bare.startsWith("qwen")) {
    return "anthropic-messages";
  }
  return "openai-compatible";
}

export function opencodeApiModelId(modelId: string): string {
  return stripOpencodeModelPrefix(modelId);
}

export function resolveOpencodeRequestModel(modelId: string): {
  plan: OpencodePlan;
  apiModelId: string;
} {
  return {
    plan: opencodePlanFromModelId(modelId),
    apiModelId: opencodeApiModelId(modelId),
  };
}

export function getOpencodeModelsUrl(plan: OpencodePlan): string {
  return plan === "go"
    ? `${OPENCODE_GO_BASE_URL}/models`
    : `${OPENCODE_ZEN_BASE_URL}/models`;
}

export function opencodeCatalogPlans(
  selectedPlan?: OpencodePlan,
): readonly OpencodePlan[] {
  return selectedPlan ? [selectedPlan] : ["zen", "go"];
}

export function defaultOpencodeModel(): string {
  return "opencode/claude-sonnet-4";
}

/** Normalize both OpenAI-style `{ data }` and OpenCode `{ models }` catalogs. */
export function normalizeOpencodeCatalogModels(
  plan: OpencodePlan,
  raw: unknown,
): CatalogModel[] {
  const payload = raw && typeof raw === "object"
    ? (raw as { data?: unknown; models?: unknown })
    : {};
  const entries = Array.isArray(payload.data)
    ? payload.data
    : Array.isArray(payload.models)
      ? payload.models
      : [];
  const models = new Map<string, CatalogModel>();
  for (const entry of entries) {
    const record = entry && typeof entry === "object"
      ? (entry as { id?: unknown; name?: unknown })
      : null;
    const rawId = typeof entry === "string"
      ? entry
      : typeof record?.id === "string"
        ? record.id
        : "";
    const bareId = stripOpencodeModelPrefix(rawId.trim());
    if (!bareId) continue;
    const id = plan === "go" ? `opencode-go/${bareId}` : `opencode/${bareId}`;
    const name = typeof record?.name === "string" && record.name.trim()
      ? record.name.trim()
      : bareId;
    models.set(id, { id, name });
  }
  return [...models.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}
