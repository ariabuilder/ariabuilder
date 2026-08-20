import type {
  AgentSettings,
  InferenceBackendId,
  ProviderInstance,
} from "../../shared/agent";

export function getProviderInstances(
  settings: AgentSettings,
): ProviderInstance[] {
  return Object.values(settings.inference.providerInstances);
}

export function getProviderState(
  settings: AgentSettings,
  backendId: InferenceBackendId,
): ProviderInstance | undefined {
  return getProviderInstances(settings).find(
    (instance) => instance.backend === backendId && instance.enabled,
  );
}

export function getProviderDefaultModelId(
  settings: AgentSettings,
  backendId: InferenceBackendId,
): string | undefined {
  const state = getProviderState(settings, backendId);
  if (!state) return undefined;
  return (
    state.defaultModelId ||
    state.enabledModelIds[0] ||
    undefined
  );
}

export function isProviderEnabled(
  settings: AgentSettings,
  backendId: InferenceBackendId,
): boolean {
  return Boolean(getProviderState(settings, backendId)?.enabled);
}
