import {
  AgentAvailabilitySchema,
  hasEnabledInferenceProvider,
  mergeAgentSettings,
  type AgentAvailability,
  type AgentSettings,
  type ConfiguredBackends,
} from "../../shared/agent";
import { resolveRequestInference } from "./inferenceSelection";

export function resolveAgentAvailability(input: {
  siteSettingsAgent: AgentSettings | undefined;
  configuredBackends: ConfiguredBackends;
  configuredInstances?: Record<string, boolean>;
}): AgentAvailability {
  const settings = mergeAgentSettings(input.siteSettingsAgent, {});
  const siteEnabled = hasEnabledInferenceProvider(settings);
  const configuredInstances = input.configuredInstances ?? {};

  if (!siteEnabled) {
    return AgentAvailabilitySchema.parse({
      canUseStudioAgent: true,
      canShowAgentShell: true,
      platform: "local",
      siteEnabled: false,
      mcpEnabled: false,
      durableAgentAvailable: false,
      workersAiAvailable: false,
      configuredBackends: input.configuredBackends,
      configuredInstances,
      effectiveInferenceBackend: "unavailable",
      reason: "disabled",
    });
  }

  const resolved = resolveRequestInference({
    settings,
    configuredBackends: input.configuredBackends,
  });

  if (!resolved) {
    return AgentAvailabilitySchema.parse({
      canUseStudioAgent: true,
      canShowAgentShell: true,
      platform: "local",
      siteEnabled: true,
      mcpEnabled: false,
      durableAgentAvailable: false,
      workersAiAvailable: false,
      configuredBackends: input.configuredBackends,
      configuredInstances,
      effectiveInferenceBackend: "unavailable",
      reason: "inference_setup_required",
    });
  }

  return AgentAvailabilitySchema.parse({
    canUseStudioAgent: true,
    canShowAgentShell: true,
    platform: "local",
    siteEnabled: true,
    mcpEnabled: false,
    durableAgentAvailable: false,
    workersAiAvailable: false,
    configuredBackends: input.configuredBackends,
    configuredInstances,
    effectiveInferenceBackend: resolved.provider,
  });
}
