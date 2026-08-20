import type { CatalogModel, InferenceBackendId, OpencodePlan } from "./settings";
import {
  getInferenceBackendDefinition,
  type InferenceBackendDefinition,
} from "./providers";

export function opencodePlanFromModelId(modelId: string): OpencodePlan {
  return modelId.trim().startsWith("opencode-go/") ? "go" : "zen";
}

export function stripOpencodeModelPrefix(modelId: string): string {
  return modelId.replace(/^opencode-go\//, "").replace(/^opencode\//, "");
}

export function catalogModelId(plan: OpencodePlan, bareModelId: string): string {
  const bare = stripOpencodeModelPrefix(bareModelId.trim());
  if (!bare) return "";
  return plan === "go" ? `opencode-go/${bare}` : `opencode/${bare}`;
}

const OPENCODE_ZEN_RECOMMENDED_BARE = [
  "big-pickle",
  "deepseek-v4-flash-free",
  "mimo-v2.5-free",
  "claude-sonnet-4",
  "claude-sonnet-4-6",
  "gpt-5.4-mini",
  "minimax-m2.5",
] as const;

const OPENCODE_GO_RECOMMENDED_BARE = [
  "deepseek-v4-flash",
  "kimi-k2.7-code",
  "kimi-k2.5",
  "minimax-m2.7",
] as const;

const OPENAI_RECOMMENDED = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-4o-mini",
  "gpt-4o",
  "o4-mini",
  "o3-mini",
] as const;

const OPENROUTER_RECOMMENDED = [
  "openai/gpt-4o-mini",
  "anthropic/claude-sonnet-4",
  "google/gemini-2.5-flash-preview",
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
  "deepseek/deepseek-chat-v3-0324",
] as const;

const ANTHROPIC_RECOMMENDED = [
  "claude-sonnet-4-20250514",
  "claude-3-7-sonnet-20250219",
] as const;

const GOOGLE_RECOMMENDED = ["gemini-2.5-flash", "gemini-2.5-pro"] as const;

function uniqueIds(ids: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      ids
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => Boolean(id)),
    ),
  );
}

function catalogIdSet(catalog: CatalogModel[]): Set<string> {
  return new Set(catalog.map((model) => model.id));
}

function resolveCuratedCatalogIds(
  catalog: CatalogModel[],
  curatedIds: readonly string[],
): string[] {
  const ids = catalogIdSet(catalog);
  if (catalog.length === 0) return [...curatedIds];
  return curatedIds.filter((id) => ids.has(id));
}

function isOpencodeFreeModel(modelId: string): boolean {
  const bare = stripOpencodeModelPrefix(modelId);
  return bare.includes("-free") || bare === "big-pickle";
}

export function listOpencodeRecommendedModelIds(
  plan: OpencodePlan,
  catalog: CatalogModel[],
): string[] {
  const planCatalog = catalog.filter(
    (model) => opencodePlanFromModelId(model.id) === plan,
  );
  const catalogIds = catalogIdSet(planCatalog);
  const bareRecommended =
    plan === "go" ? OPENCODE_GO_RECOMMENDED_BARE : OPENCODE_ZEN_RECOMMENDED_BARE;

  const curated = bareRecommended
    .map((bareId) => catalogModelId(plan, bareId))
    .filter((id) => catalogIds.size === 0 || catalogIds.has(id));

  const freeModels = planCatalog
    .filter((model) => isOpencodeFreeModel(model.id))
    .map((model) => model.id);

  const merged = uniqueIds([...curated, ...freeModels]);
  if (merged.length > 0) return merged;
  return planCatalog.slice(0, 8).map((model) => model.id);
}

function listCompatibleRecommendedModelIds(catalog: CatalogModel[]): string[] {
  if (catalog.length === 0) return [];
  const preferred = catalog.filter((model) => {
    const id = model.id.toLowerCase();
    return (
      id.includes("gpt") ||
      id.includes("claude") ||
      id.includes("llama") ||
      id.includes("mistral") ||
      id.includes("deepseek")
    );
  });
  const source = preferred.length > 0 ? preferred : catalog;
  return source.slice(0, 8).map((model) => model.id);
}

export function listRecommendedModelIds(input: {
  backendId: InferenceBackendId;
  catalog: CatalogModel[];
}): string[] {
  const definition: InferenceBackendDefinition =
    getInferenceBackendDefinition(input.backendId);

  switch (input.backendId) {
    case "opencode":
      return uniqueIds([
        ...listOpencodeRecommendedModelIds("zen", input.catalog),
        ...listOpencodeRecommendedModelIds("go", input.catalog),
      ]);
    case "openai":
      return uniqueIds([
        ...definition.seedModelIds,
        ...resolveCuratedCatalogIds(input.catalog, OPENAI_RECOMMENDED),
      ]);
    case "openrouter":
      return uniqueIds([
        ...definition.seedModelIds,
        ...resolveCuratedCatalogIds(input.catalog, OPENROUTER_RECOMMENDED),
      ]);
    case "anthropic":
      return uniqueIds([
        ...definition.seedModelIds,
        ...resolveCuratedCatalogIds(input.catalog, ANTHROPIC_RECOMMENDED),
      ]);
    case "google":
      return uniqueIds([
        ...definition.seedModelIds,
        ...resolveCuratedCatalogIds(input.catalog, GOOGLE_RECOMMENDED),
      ]);
    case "openai_compatible":
      return listCompatibleRecommendedModelIds(input.catalog);
  }
}

export function pickRecommendedDefaultModelId(input: {
  backendId: InferenceBackendId;
  recommendedModelIds: string[];
  currentDefaultModelId?: string;
}): string | undefined {
  if (
    input.currentDefaultModelId &&
    input.recommendedModelIds.includes(input.currentDefaultModelId)
  ) {
    return input.currentDefaultModelId;
  }

  const definition = getInferenceBackendDefinition(input.backendId);
  if (
    definition.defaultModelId &&
    input.recommendedModelIds.includes(definition.defaultModelId)
  ) {
    return definition.defaultModelId;
  }

  return input.recommendedModelIds[0];
}

/**
 * Materialize the runtime allowlist from an authoritative provider catalog and
 * the user's durable opt-outs. New catalog models are enabled automatically.
 */
export function reconcileCatalogModelAvailability(input: {
  backendId: InferenceBackendId;
  catalogModelIds: string[];
  disabledModelIds: string[];
  currentDefaultModelId?: string;
}): {
  enabledModelIds: string[];
  disabledModelIds: string[];
  defaultModelId?: string;
} {
  const catalogModelIds = uniqueIds(input.catalogModelIds);
  const disabledModelIds = uniqueIds(input.disabledModelIds);
  const disabled = new Set(disabledModelIds);
  const enabledModelIds = catalogModelIds.filter((id) => !disabled.has(id));
  return {
    enabledModelIds,
    disabledModelIds,
    defaultModelId: pickRecommendedDefaultModelId({
      backendId: input.backendId,
      recommendedModelIds: enabledModelIds,
      currentDefaultModelId: input.currentDefaultModelId,
    }),
  };
}
