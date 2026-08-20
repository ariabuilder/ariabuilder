import type {
  AgentSettingsPatch,
  InferenceDefault,
} from "../../../../shared/agent"

/** Copy a potentially reactive Vue value into an Electron-cloneable payload. */
export function cloneInferenceDefault(
  value: InferenceDefault | undefined,
): InferenceDefault | undefined {
  return value
    ? { instanceId: value.instanceId, modelId: value.modelId }
    : undefined
}

export function isLegacyDisabledModelsSchemaError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message?: unknown }).message ?? "")
        : String(error ?? "")
  return (
    message.includes("disabledModelIds") &&
    (message.includes("unrecognized_keys") || message.includes("Unrecognized key"))
  )
}

/** Compatibility for a hot-reloaded renderer talking to the prior main bundle. */
export function withoutDisabledModelIds(
  patch: AgentSettingsPatch,
): AgentSettingsPatch {
  const providers = patch.inference?.providerInstances
  if (!providers) return patch
  const providerInstances: NonNullable<
    NonNullable<AgentSettingsPatch["inference"]>["providerInstances"]
  > = {}
  for (const [instanceId, instancePatch] of Object.entries(providers)) {
    if (!instancePatch || typeof instancePatch !== "object") {
      providerInstances[instanceId] = instancePatch
      continue
    }
    const { disabledModelIds: _disabledModelIds, ...legacyPatch } = instancePatch
    providerInstances[instanceId] = legacyPatch
  }
  return {
    ...patch,
    inference: {
      ...patch.inference,
      providerInstances,
    },
  }
}
