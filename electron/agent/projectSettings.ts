import {
  activateConfiguredAgentProviders,
  type AgentSettings,
  type ConfiguredBackends,
} from "../../shared/agent";
import { listConfiguredBackends } from "../secrets";
import { readSiteSettings, writeAgentSettings } from "../siteSettings";

export type ProjectAgentSettings = {
  settings: AgentSettings;
  configuredBackends: ConfiguredBackends;
};

/** Resolve user-level credentials into the current project's agent settings. */
export function resolveProjectAgentSettings(
  userData: string,
  projectPath: string,
): ProjectAgentSettings {
  const current = readSiteSettings(projectPath).agent;
  const configuredBackends = listConfiguredBackends(userData);
  const settings = activateConfiguredAgentProviders(
    current,
    configuredBackends,
  );

  if (JSON.stringify(settings) !== JSON.stringify(current)) {
    writeAgentSettings(projectPath, settings);
  }

  return { settings, configuredBackends };
}
