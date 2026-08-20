import type {
  AgentAvailability,
  AgentChatInput,
  AgentSettings,
  AgentSettingsPatch,
  AgentStreamEvent,
  AgentRendererToolRequest,
  AgentRendererToolResponse,
  AgentRendererHostRegistration,
  CatalogModel,
  CredentialBackendId,
  CredentialStorageKind,
  UpdateAgentProviderInput,
} from "../../shared/agent";

function api() {
  const agent = window.aria?.agent;
  if (!agent) throw new Error("Aria agent API is unavailable");
  return agent;
}

/**
 * Electron IPC cannot structured-clone Vue reactive proxies. Agent inputs are
 * JSON contracts, so rebuild object payloads as plain data before invoking the
 * preload bridge.
 */
function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function getAgentAvailability(
  projectPath: string,
): Promise<AgentAvailability> {
  return api().getAvailability(projectPath);
}

export function getAgentSettings(projectPath: string): Promise<AgentSettings> {
  return api().getSettings(projectPath);
}

export function patchAgentSettings(
  projectPath: string,
  patch: AgentSettingsPatch,
): Promise<AgentSettings> {
  return api().patchSettings(projectPath, toIpcPayload(patch));
}

export function setProviderCredentials(
  input: UpdateAgentProviderInput,
): Promise<{ configured: true; storage: CredentialStorageKind }> {
  return api().setProviderCredentials(toIpcPayload(input));
}

export function confirmInsecureProviderCredentials(
  backend: CredentialBackendId,
  instanceId?: string,
): Promise<{ configured: true; storage: "insecure" }> {
  return api().confirmInsecureProviderCredentials(
    backend,
    instanceId,
    "PERSIST_INSECURELY",
  );
}

export function clearProviderCredentials(
  backend: CredentialBackendId,
  instanceId?: string,
): Promise<{ removed: true }> {
  return api().clearProviderCredentials(backend, instanceId);
}

export function removeInferenceProvider(
  projectPath: string,
  instanceId: string,
): Promise<AgentSettings> {
  return api().removeInferenceProvider(projectPath, instanceId);
}

export function getCredentialStatuses() {
  return api().getCredentialStatuses();
}

export function listCatalogModels(
  projectPath: string,
  instanceId: string,
): Promise<{ models: CatalogModel[] }> {
  return api().listCatalogModels(projectPath, instanceId);
}

export function startAgentChat(
  projectPath: string,
  streamId: string,
  body: AgentChatInput,
): Promise<{ streamId: string }> {
  return api().startChat(projectPath, streamId, toIpcPayload(body));
}

export function cancelAgentChat(
  projectPath: string,
  streamId: string,
): Promise<{ canceled: true }> {
  return api().cancelChat(projectPath, streamId);
}

export function registerAgentRendererHost(
  input: AgentRendererHostRegistration,
): Promise<{ registered: boolean }> {
  return api().registerRendererHost(
    input.projectPath,
    input.active,
    input.scope,
    input.registrationId,
  );
}

export function resolveAgentRendererTool(
  response: AgentRendererToolResponse,
): Promise<{ accepted: true }> {
  return api().resolveRendererTool(toIpcPayload(response));
}

export function onAgentRendererToolRequest(
  handler: (request: AgentRendererToolRequest) => void,
): () => void {
  return api().onRendererToolRequest(handler);
}

export function onAgentStream(
  handler: (payload: {
    streamId: string;
    event: AgentStreamEvent;
  }) => void,
): () => void {
  return api().onStream(handler);
}
