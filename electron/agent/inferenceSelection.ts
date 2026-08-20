import {
  CREDENTIAL_BACKEND_IDS,
  INFERENCE_BACKEND_DEFINITIONS,
  type AgentSettings,
  type AgentSessionModelOverride,
  type ConfiguredBackends,
  type InferenceBackendId,
} from "../../shared/agent";
import {
  getProviderDefaultModelId,
  getProviderState,
} from "./inferenceHelpers";

export interface ResolvedInferenceSelection {
  instanceId: string;
  provider: InferenceBackendId;
  modelId: string;
}

function isCredentialBackendConfigured(
  backendId: InferenceBackendId,
  configuredBackends: ConfiguredBackends,
): boolean {
  return configuredBackends[backendId] === true;
}

function isBackendReady(input: {
  settings: AgentSettings;
  backendId: InferenceBackendId;
  configuredBackends: ConfiguredBackends;
  sessionModelId?: string;
}): boolean {
  const state = getProviderState(input.settings, input.backendId);
  if (!state?.enabled) return false;
  if (!isCredentialBackendConfigured(input.backendId, input.configuredBackends)) {
    return false;
  }
  if (state.enabledModelIds.length === 0) return false;

  const enabledModelIds = state.enabledModelIds;
  const defaultModelId = getProviderDefaultModelId(
    input.settings,
    input.backendId,
  );
  const session = input.sessionModelId?.trim();
  const modelId =
    (session && enabledModelIds.includes(session) ? session : undefined) ??
    (defaultModelId && enabledModelIds.includes(defaultModelId)
      ? defaultModelId
      : undefined) ??
    enabledModelIds[0]?.trim();

  return Boolean(modelId && enabledModelIds.includes(modelId));
}

export function listReadyInferenceBackends(input: {
  settings: AgentSettings;
  configuredBackends: ConfiguredBackends;
  sessionProvider?: InferenceBackendId;
  sessionModelId?: string;
}): InferenceBackendId[] {
  const backends = INFERENCE_BACKEND_DEFINITIONS.map((b) => b.id);
  return backends.filter((backendId) => {
    const sessionModelId =
      input.sessionProvider === backendId ? input.sessionModelId : undefined;
    return isBackendReady({
      settings: input.settings,
      backendId,
      configuredBackends: input.configuredBackends,
      sessionModelId,
    });
  });
}

export function resolveRequestInference(input: {
  settings: AgentSettings;
  configuredBackends: ConfiguredBackends;
  sessionOverride?: AgentSessionModelOverride;
}): ResolvedInferenceSelection | null {
  const sessionProvider = input.sessionOverride?.inferenceProvider;
  const sessionModelId = input.sessionOverride?.modelId;

  if (sessionProvider) {
    if (
      isBackendReady({
        settings: input.settings,
        backendId: sessionProvider,
        configuredBackends: input.configuredBackends,
        sessionModelId,
      })
    ) {
      const state = getProviderState(input.settings, sessionProvider);
      if (!state) return null;
      const modelId =
        (sessionModelId && state.enabledModelIds.includes(sessionModelId)
          ? sessionModelId
          : undefined) ??
        getProviderDefaultModelId(input.settings, sessionProvider) ??
        state.enabledModelIds[0]!;
      return {
        instanceId: state.id,
        provider: sessionProvider,
        modelId,
      };
    }
  }

  const siteDefault = input.settings.inference.default;
  if (siteDefault) {
    const instance =
      input.settings.inference.providerInstances[siteDefault.instanceId];
    if (
      instance?.enabled &&
      isBackendReady({
        settings: input.settings,
        backendId: instance.backend,
        configuredBackends: input.configuredBackends,
        sessionModelId: siteDefault.modelId,
      })
    ) {
      return {
        instanceId: instance.id,
        provider: instance.backend,
        modelId: siteDefault.modelId,
      };
    }
  }

  for (const backendId of CREDENTIAL_BACKEND_IDS) {
    if (
      !isBackendReady({
        settings: input.settings,
        backendId,
        configuredBackends: input.configuredBackends,
      })
    ) {
      continue;
    }
    const state = getProviderState(input.settings, backendId);
    if (!state) continue;
    const modelId =
      getProviderDefaultModelId(input.settings, backendId) ??
      state.enabledModelIds[0]!;
    return {
      instanceId: state.id,
      provider: backendId,
      modelId,
    };
  }

  return null;
}

export function assertModelAllowed(
  settings: AgentSettings,
  provider: InferenceBackendId,
  modelId: string,
): void {
  const state = getProviderState(settings, provider);
  if (!state?.enabled) {
    throw new Error(`Provider ${provider} is not enabled`);
  }
  if (!state.enabledModelIds.includes(modelId)) {
    throw new Error(`Model ${modelId} is not enabled for ${provider}`);
  }
}

export function canUseChatInference(input: {
  settings: AgentSettings;
  configuredBackends: ConfiguredBackends;
}): boolean {
  return listReadyInferenceBackends(input).length > 0;
}
