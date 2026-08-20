import { z } from "zod";

/** BYOK backends only — no Workers AI on desktop. */
export const InferenceBackendIdSchema = z.enum([
  "opencode",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "openai_compatible",
]);
export type InferenceBackendId = z.infer<typeof InferenceBackendIdSchema>;

export const CredentialBackendIdSchema = InferenceBackendIdSchema;
export type CredentialBackendId = InferenceBackendId;

export const CREDENTIAL_BACKEND_IDS = [
  "opencode",
  "openai",
  "anthropic",
  "google",
  "openrouter",
  "openai_compatible",
] as const satisfies readonly CredentialBackendId[];

export function isCredentialBackend(
  backendId: string,
): backendId is CredentialBackendId {
  return (CREDENTIAL_BACKEND_IDS as readonly string[]).includes(backendId);
}

export const OpencodePlanSchema = z.enum(["zen", "go"]);
export type OpencodePlan = z.infer<typeof OpencodePlanSchema>;

export const InferenceRouteSchema = z
  .object({ type: z.literal("direct") })
  .strict();
export type InferenceRoute = z.infer<typeof InferenceRouteSchema>;

export const ProviderInstanceSchema = z
  .object({
    id: z.string().uuid(),
    backend: InferenceBackendIdSchema,
    label: z.string().min(1).max(64),
    enabled: z.boolean().default(true),
    defaultModelId: z.string().max(128).optional(),
    enabledModelIds: z.array(z.string().max(128)).default([]),
    /** Opt-out list. Catalog models not listed here are enabled automatically. */
    disabledModelIds: z.array(z.string().max(128)).default([]),
    opencodePlan: OpencodePlanSchema.optional(),
    baseUrl: z.string().url().max(512).optional(),
    route: InferenceRouteSchema.optional(),
  })
  .strict();

export type ProviderInstance = z.infer<typeof ProviderInstanceSchema>;

export const InferenceDefaultSchema = z
  .object({
    instanceId: z.string().uuid(),
    modelId: z.string().min(1).max(128),
  })
  .strict();

export type InferenceDefault = z.infer<typeof InferenceDefaultSchema>;

export const AgentInferenceSettingsSchema = z
  .object({
    default: InferenceDefaultSchema.optional(),
    providerInstances: z.record(z.string(), ProviderInstanceSchema).default({}),
  })
  .strict();

export type AgentInferenceSettings = z.infer<
  typeof AgentInferenceSettingsSchema
>;

export const AgentSkillSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(80),
    instructions: z.string().trim().min(1).max(2048),
  })
  .strict();

export type AgentSkill = z.infer<typeof AgentSkillSchema>;

const AgentSkillsSchema = z.array(AgentSkillSchema).max(8);

export const AgentSettingsFieldsSchema = z
  .object({
    enabled: z.boolean().default(false),
    mcpEnabled: z.boolean().default(false),
    inference: AgentInferenceSettingsSchema.default({ providerInstances: {} }),
    siteInstructions: z.string().max(2048).optional(),
    skills: AgentSkillsSchema.default([]),
  })
  .strict();

export type AgentSettingsFields = z.infer<typeof AgentSettingsFieldsSchema>;

function refineAgentSettings(
  value: AgentSettingsFields,
  ctx: z.RefinementCtx,
): void {
  const siteDefault = value.inference.default;
  if (!siteDefault) return;

  const instance = value.inference.providerInstances[siteDefault.instanceId];
  if (!instance?.enabled) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inference", "default"],
      message: "Default provider must be enabled",
    });
    return;
  }

  if (!instance.enabledModelIds.includes(siteDefault.modelId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["inference", "default"],
      message: "Default model must be enabled for the provider",
    });
  }
}

export const AgentSettingsSchema =
  AgentSettingsFieldsSchema.superRefine(refineAgentSettings);

export type AgentSettings = z.infer<typeof AgentSettingsSchema>;

const PROVIDER_INSTANCE_KEYS = [
  "id",
  "backend",
  "label",
  "enabled",
  "defaultModelId",
  "enabledModelIds",
  "disabledModelIds",
  "opencodePlan",
  "baseUrl",
  "route",
] as const satisfies readonly (keyof ProviderInstance)[];

function knownProviderInstanceFields(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const source = input as Record<string, unknown>;
  return Object.fromEntries(
    PROVIDER_INSTANCE_KEYS.flatMap((key) =>
      key in source ? [[key, source[key]]] : [],
    ),
  );
}

/**
 * Read persisted settings defensively. Agent settings have evolved across app
 * versions, so one stale field or damaged provider must not reset every valid
 * provider to the empty defaults on the next launch.
 */
function recoverAgentSettings(input: unknown): AgentSettings {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const inferenceSource =
    source.inference &&
    typeof source.inference === "object" &&
    !Array.isArray(source.inference)
      ? (source.inference as Record<string, unknown>)
      : {};
  const providersSource =
    inferenceSource.providerInstances &&
    typeof inferenceSource.providerInstances === "object" &&
    !Array.isArray(inferenceSource.providerInstances)
      ? (inferenceSource.providerInstances as Record<string, unknown>)
      : {};
  const providerInstances: Record<string, ProviderInstance> = {};

  for (const [instanceId, rawInstance] of Object.entries(providersSource)) {
    const parsed = ProviderInstanceSchema.safeParse(
      knownProviderInstanceFields(rawInstance),
    );
    if (parsed.success) providerInstances[instanceId] = parsed.data;
  }

  const inference: AgentInferenceSettings = { providerInstances };
  const parsedDefault = InferenceDefaultSchema.safeParse(inferenceSource.default);
  if (parsedDefault.success) {
    const provider = providerInstances[parsedDefault.data.instanceId];
    if (
      provider?.enabled &&
      provider.enabledModelIds.includes(parsedDefault.data.modelId)
    ) {
      inference.default = parsedDefault.data;
    }
  }

  const skills = AgentSkillsSchema.safeParse(source.skills);
  const siteInstructions = z.string().max(2048).safeParse(source.siteInstructions);
  return AgentSettingsFieldsSchema.parse({
    enabled: typeof source.enabled === "boolean" ? source.enabled : undefined,
    mcpEnabled:
      typeof source.mcpEnabled === "boolean" ? source.mcpEnabled : undefined,
    inference,
    siteInstructions: siteInstructions.success
      ? siteInstructions.data
      : undefined,
    skills: skills.success ? skills.data : undefined,
  }) as AgentSettings;
}

const nullishInferenceDefault = z
  .union([InferenceDefaultSchema, z.null()])
  .optional();
const nullishSiteInstructions = z
  .union([z.string().max(2048), z.null()])
  .optional();
const nullishAgentSkills = z.union([AgentSkillsSchema, z.null()]).optional();

/** Partial updates merge onto the existing instance; null deletes it. */
const ProviderInstancePatchSchema = ProviderInstanceSchema.partial().strict();
const nullishProviderInstance = z
  .union([ProviderInstancePatchSchema, z.null()])
  .optional();

const InferencePatchSchema = z
  .object({
    default: nullishInferenceDefault,
    providerInstances: z.record(z.string(), nullishProviderInstance).optional(),
  })
  .strict();

export const AgentSettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    mcpEnabled: z.boolean().optional(),
    inference: InferencePatchSchema.optional(),
    siteInstructions: nullishSiteInstructions,
    skills: nullishAgentSkills,
  })
  .strict();

export type AgentSettingsPatch = z.infer<typeof AgentSettingsPatchSchema>;

function mergeInferenceSettings(
  current: AgentInferenceSettings,
  patch: z.infer<typeof InferencePatchSchema>,
): AgentInferenceSettings {
  const next: AgentInferenceSettings = {
    default: current.default,
    providerInstances: { ...current.providerInstances },
  };

  if (patch.default === null) {
    next.default = undefined;
  } else if (patch.default !== undefined) {
    next.default = patch.default;
  }

  if (patch.providerInstances) {
    for (const [instanceId, instancePatch] of Object.entries(
      patch.providerInstances,
    )) {
      if (instancePatch === null) {
        delete next.providerInstances[instanceId];
        continue;
      }
      if (instancePatch === undefined) continue;
      next.providerInstances[instanceId] = ProviderInstanceSchema.parse({
        ...next.providerInstances[instanceId],
        ...instancePatch,
      });
    }
  }

  if (
    next.default &&
    !next.providerInstances[next.default.instanceId]?.enabledModelIds.includes(
      next.default.modelId,
    )
  ) {
    next.default = undefined;
  }

  return AgentInferenceSettingsSchema.parse(next);
}

export function parseAgentSettings(input: unknown): AgentSettings {
  const parsed = AgentSettingsFieldsSchema.safeParse(input ?? {});
  if (parsed.success) {
    const strict = AgentSettingsSchema.safeParse(parsed.data);
    return strict.success ? strict.data : recoverAgentSettings(input);
  }
  return recoverAgentSettings(input);
}

export const DEFAULT_AGENT_SETTINGS: AgentSettings = parseAgentSettings({});

export function mergeAgentSettings(
  current: AgentSettings | undefined,
  patch: AgentSettingsPatch,
): AgentSettings {
  const base = parseAgentSettings(current);
  const merged: Record<string, unknown> = { ...base };

  for (const [key, value] of Object.entries(patch) as Array<
    [keyof AgentSettingsFields, AgentSettingsPatch[keyof AgentSettingsPatch]]
  >) {
    if (key === "inference") {
      if (value !== undefined) {
        merged.inference = mergeInferenceSettings(
          base.inference,
          value as z.infer<typeof InferencePatchSchema>,
        );
      }
      continue;
    }

    if (value === null) {
      delete merged[key];
      continue;
    }
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  const parsed = AgentSettingsFieldsSchema.parse(merged);
  const strict = AgentSettingsSchema.safeParse(parsed);
  return strict.success ? strict.data : (parsed as AgentSettings);
}

export function hasEnabledInferenceProvider(
  settings: Pick<AgentSettings, "inference">,
): boolean {
  return Object.values(settings.inference.providerInstances).some(
    (provider) => provider.enabled,
  );
}

export function buildRemoveInferenceProviderPatch(
  current: AgentSettings | undefined,
  instanceId: string,
): AgentSettingsPatch {
  const base = parseAgentSettings(current);
  const patch: AgentSettingsPatch = {
    inference: {
      providerInstances: {
        [instanceId]: null,
      },
    },
  };

  if (base.inference.default?.instanceId === instanceId) {
    const remaining = Object.values(base.inference.providerInstances).find(
      (inst) =>
        inst.id !== instanceId &&
        inst.enabled &&
        inst.enabledModelIds.length > 0,
    );

    if (remaining) {
      patch.inference!.default = {
        instanceId: remaining.id,
        modelId: remaining.defaultModelId ?? remaining.enabledModelIds[0]!,
      };
    } else {
      patch.inference!.default = null;
    }
  }

  return patch;
}

export const ConfiguredBackendsSchema = z
  .object({
    opencode: z.boolean().optional(),
    openai: z.boolean().optional(),
    anthropic: z.boolean().optional(),
    google: z.boolean().optional(),
    openrouter: z.boolean().optional(),
    openai_compatible: z.boolean().optional(),
  })
  .strict();

export type ConfiguredBackends = z.infer<typeof ConfiguredBackendsSchema>;

export const AgentAvailabilityReasonSchema = z.enum([
  "disabled",
  "inference_setup_required",
]);
export type AgentAvailabilityReason = z.infer<
  typeof AgentAvailabilityReasonSchema
>;

export const AgentPlatformSchema = z.literal("local");
export type AgentPlatform = z.infer<typeof AgentPlatformSchema>;

export const AgentAvailabilitySchema = z
  .object({
    canUseStudioAgent: z.boolean(),
    canShowAgentShell: z.boolean(),
    platform: AgentPlatformSchema,
    siteEnabled: z.boolean(),
    mcpEnabled: z.literal(false),
    durableAgentAvailable: z.literal(false),
    workersAiAvailable: z.literal(false),
    configuredBackends: ConfiguredBackendsSchema,
    /** Per provider-instance credential resolvability (mirrors load). */
    configuredInstances: z.record(z.string(), z.boolean()).default({}),
    effectiveInferenceBackend: z
      .union([InferenceBackendIdSchema, z.literal("unavailable")])
      .default("unavailable"),
    reason: AgentAvailabilityReasonSchema.optional(),
  })
  .strict();

export type AgentAvailability = z.infer<typeof AgentAvailabilitySchema>;

export const CatalogModelSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    toolSupport: z.enum(["supported", "unknown"]).optional(),
  })
  .strict();

export type CatalogModel = z.infer<typeof CatalogModelSchema>;

export const CatalogModelsResponseSchema = z
  .object({
    models: z.array(CatalogModelSchema),
  })
  .strict();

export const UpdateAgentProviderInputSchema = z
  .object({
    provider: CredentialBackendIdSchema,
    instanceId: z.string().uuid().optional(),
    apiKey: z.string().min(1).max(4096),
    baseUrl: z.string().url().max(512).optional(),
    persistence: z.enum(["session", "persistent"]).default("persistent"),
    insecurePersistenceConfirmation: z
      .literal("PERSIST_INSECURELY")
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.provider === "openai_compatible" && !value.baseUrl?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["baseUrl"],
        message: "Base URL is required for OpenAI-compatible providers",
      });
      return;
    }
    if (value.provider === "openai_compatible" && value.baseUrl) {
      const url = new URL(value.baseUrl);
      const loopback =
        url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "[::1]" ||
        url.hostname === "::1";
      if (
        url.protocol !== "https:" &&
        !(url.protocol === "http:" && loopback)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["baseUrl"],
          message:
            "Use HTTPS for remote providers. HTTP is allowed only for localhost.",
        });
      }
    }
  });

export type UpdateAgentProviderInput = z.infer<
  typeof UpdateAgentProviderInputSchema
>;

export const CredentialStorageKindSchema = z.enum([
  "keychain",
  "session",
  "insecure",
]);
export type CredentialStorageKind = z.infer<
  typeof CredentialStorageKindSchema
>;

export const CredentialStorageCapabilitySchema = z
  .object({
    backend: z.string(),
    secure: z.boolean(),
    persistent: z.boolean(),
    defaultStorage: CredentialStorageKindSchema,
  })
  .strict();
export type CredentialStorageCapability = z.infer<
  typeof CredentialStorageCapabilitySchema
>;

export const StoredProviderCredentialsSchema = z
  .object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type StoredProviderCredentials = z.infer<
  typeof StoredProviderCredentialsSchema
>;
