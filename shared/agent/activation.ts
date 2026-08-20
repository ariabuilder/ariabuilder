import {
  CREDENTIAL_BACKEND_IDS,
  type AgentSettings,
  type AgentSettingsPatch,
  type ConfiguredBackends,
  type ProviderInstance,
  mergeAgentSettings,
} from "./settings";
import {
  buildInitialProviderInstance,
  getInferenceBackendDefinition,
} from "./providers";

/**
 * API keys are user-level state. Materialize and activate their providers in
 * project settings so opening another project does not require setup again.
 * Project-specific model availability and defaults are preserved when present.
 */
export function activateConfiguredAgentProviders(
  current: AgentSettings | undefined,
  configuredBackends: ConfiguredBackends,
): AgentSettings {
  const base = mergeAgentSettings(current, {});
  const providerInstances: NonNullable<
    NonNullable<AgentSettingsPatch["inference"]>["providerInstances"]
  > = {};
  const configuredInstances: ProviderInstance[] = [];

  for (const backend of CREDENTIAL_BACKEND_IDS) {
    if (configuredBackends[backend] !== true) continue;

    const existing = Object.values(base.inference.providerInstances).filter(
      (instance) => instance.backend === backend,
    );
    if (existing.length > 0) {
      for (const instance of existing) {
        configuredInstances.push(instance);
        if (!instance.enabled) {
          providerInstances[instance.id] = { enabled: true };
        }
      }
      continue;
    }

    const definition = getInferenceBackendDefinition(backend);
    const instance = buildInitialProviderInstance(backend, definition.label);
    configuredInstances.push(instance);
    providerInstances[instance.id] = instance;
  }

  if (configuredInstances.length === 0) return base;

  const patch: AgentSettingsPatch = {
    enabled: true,
    inference: {
      providerInstances,
    },
  };

  if (!base.inference.default) {
    const firstReady = configuredInstances.find(
      (instance) =>
        instance.defaultModelId &&
        instance.enabledModelIds.includes(instance.defaultModelId),
    );
    if (firstReady?.defaultModelId) {
      patch.inference!.default = {
        instanceId: firstReady.id,
        modelId: firstReady.defaultModelId,
      };
    }
  }

  return mergeAgentSettings(base, patch);
}
