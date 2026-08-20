import type { WebContents } from "electron";
import {
  AgentSettingsPatchSchema,
  UpdateAgentProviderInputSchema,
  buildRemoveInferenceProviderPatch,
  isCredentialBackend,
  mergeAgentSettings,
  parseAgentSettings,
  type AgentAvailability,
  type AgentSettings,
  type CatalogModel,
  type CredentialBackendId,
  type CredentialStorageKind,
} from "../../shared/agent";
import {
  confirmLegacyInsecureCredentials,
  getCredentialStorageCapability,
  getProviderCredentialStatus,
  ensureLegacyCredentialMirrors,
  listConfiguredBackends,
  loadProviderCredentials,
  removeProviderCredentials,
  saveProviderCredentials,
} from "../secrets";
import {
  readSiteSettings,
  writeAgentSettings,
} from "../siteSettings";
import { resolveAgentAvailability } from "./availability";
import {
  getOpencodeModelsUrl,
  normalizeOpencodeCatalogModels,
  opencodeCatalogPlans,
  OPENROUTER_API_BASE,
} from "./opencodeProviders";
import {
  dispatchAgentRendererTool,
  disposeAgentRendererBridgeForProject,
  getAgentRendererHostCapabilities,
} from "./rendererToolBridge";
import {
  clearPendingConfirmationsForProject,
  clearPendingConfirmationsForWebContents,
} from "./confirmationStore";
import { resolveProjectAgentSettings } from "./projectSettings";
export {
  disposeAgentRendererBridgeForWebContents,
  registerAgentRendererHost,
  resolveAgentRendererTool,
} from "./rendererToolBridge";

type ActiveAgentStream = {
  controller: AbortController;
  projectPath: string;
  webContentsId: number;
  done: Promise<void>;
};

const activeStreams = new Map<string, ActiveAgentStream>();

export function getAgentAvailability(
  userData: string,
  projectPath: string,
): AgentAvailability {
  ensureLegacyCredentialMirrors(userData);
  const { settings: agent, configuredBackends } = resolveProjectAgentSettings(
    userData,
    projectPath,
  );
  const configuredInstances: Record<string, boolean> = {};
  for (const instance of Object.values(agent.inference.providerInstances)) {
    if (!isCredentialBackend(instance.backend)) continue;
    configuredInstances[instance.id] = getProviderCredentialStatus(
      userData,
      instance.backend,
      instance.id,
    ).configured;
  }
  return resolveAgentAvailability({
    siteSettingsAgent: agent,
    configuredBackends,
    configuredInstances,
  });
}

export function getAgentSettings(
  userData: string,
  projectPath: string,
): AgentSettings {
  return resolveProjectAgentSettings(userData, projectPath).settings;
}

export function patchAgentSettings(
  userData: string,
  projectPath: string,
  patchRaw: unknown,
): AgentSettings {
  const patch = AgentSettingsPatchSchema.parse(patchRaw);
  const current = resolveProjectAgentSettings(userData, projectPath).settings;
  const nextAgent = mergeAgentSettings(current, patch);
  return writeAgentSettings(projectPath, nextAgent);
}

export function setProviderCredentials(
  userData: string,
  inputRaw: unknown,
): { configured: true; storage: CredentialStorageKind } {
  const input = UpdateAgentProviderInputSchema.parse(inputRaw);
  return saveProviderCredentials(userData, input);
}

export function confirmInsecureProviderCredentials(
  userData: string,
  backend: CredentialBackendId,
  instanceId: string | undefined,
  confirmation: string,
): { configured: true; storage: "insecure" } {
  return confirmLegacyInsecureCredentials(
    userData,
    backend,
    instanceId,
    confirmation,
  );
}

export function clearProviderCredentials(
  userData: string,
  backend: CredentialBackendId,
  instanceId?: string,
): { removed: true } {
  return removeProviderCredentials(userData, backend, instanceId);
}

export function removeInferenceProvider(
  userData: string,
  projectPath: string,
  instanceId: string,
): AgentSettings {
  const current = readSiteSettings(projectPath);
  const agent = parseAgentSettings(current.agent);
  const patch = buildRemoveInferenceProviderPatch(agent, instanceId);
  const nextAgent = mergeAgentSettings(agent, patch);
  writeAgentSettings(projectPath, nextAgent);
  // Credentials are user-level BYOK material. Removing a provider from one
  // project must never delete credentials that another project may still use.
  // Credential deletion remains an explicit Settings action.
  void userData;
  return nextAgent;
}

export function getCredentialStatuses(userData: string) {
  const backends = listConfiguredBackends(userData);
  return {
    backends,
    capability: getCredentialStorageCapability(),
    statuses: {
      opencode: getProviderCredentialStatus(userData, "opencode"),
      openai: getProviderCredentialStatus(userData, "openai"),
      anthropic: getProviderCredentialStatus(userData, "anthropic"),
      google: getProviderCredentialStatus(userData, "google"),
      openrouter: getProviderCredentialStatus(userData, "openrouter"),
      openai_compatible: getProviderCredentialStatus(
        userData,
        "openai_compatible",
      ),
    },
  };
}

async function fetchJsonModels(
  url: string,
  apiKey: string,
  map: (raw: unknown) => CatalogModel[],
): Promise<CatalogModel[]> {
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Catalog request failed (${response.status})`);
  }
  const json = (await response.json()) as unknown;
  return map(json);
}

function catalogInstance(
  userData: string,
  projectPath: string,
  instanceId: string,
) {
  const settings = getAgentSettings(userData, projectPath);
  const instance = settings.inference.providerInstances[instanceId];
  if (!instance) throw new Error("Provider instance was not found");
  return instance;
}

function compatibleCatalogBaseUrl(raw: string | undefined): string {
  if (!raw?.trim()) throw new Error("Compatible provider base URL is required");
  const url = new URL(raw.trim());
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "Compatible provider URLs must use HTTPS; HTTP is allowed only for localhost",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function isLikelyOpenAiTextModel(id: string): boolean {
  const value = id.toLowerCase();
  if (
    /(?:embedding|moderation|whisper|tts|dall-e|image|audio|transcribe|realtime)/.test(
      value,
    )
  ) {
    return false;
  }
  return /^(?:gpt-|o\d|chatgpt-|codex-)/.test(value);
}

function isPresent<T>(value: T | null): value is T {
  return value !== null;
}

export async function listCatalogModels(
  userData: string,
  projectPath: string,
  instanceId: string,
): Promise<{ models: CatalogModel[] }> {
  const instance = catalogInstance(userData, projectPath, instanceId);
  const backend = instance.backend;
  const credentials = loadProviderCredentials(userData, backend, instanceId);
  if (!credentials) {
    return { models: [] };
  }

  if (backend === "opencode") {
    const plans = opencodeCatalogPlans(instance.opencodePlan);
    const results = await Promise.allSettled(
      plans.map((plan) =>
        fetchJsonModels(
          getOpencodeModelsUrl(plan),
          credentials.apiKey,
          (json) => normalizeOpencodeCatalogModels(plan, json),
        ),
      ),
    );
    const models = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : [],
    );
    if (models.length === 0) {
      const failures = results
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) =>
          result.reason instanceof Error ? result.reason.message : String(result.reason),
        );
      throw new Error(failures.join("; ") || "No OpenCode Zen or Go models were returned");
    }
    return {
      models: [...new Map(models.map((model) => [model.id, model])).values()],
    };
  }

  if (backend === "openai") {
    const models = await fetchJsonModels(
      "https://api.openai.com/v1/models",
      credentials.apiKey,
      (json) => {
        const data = (json as { data?: unknown }).data;
        if (!Array.isArray(data)) return [];
        return data
          .map((item) => {
            const id = String((item as { id?: string })?.id ?? "").trim();
            return id && isLikelyOpenAiTextModel(id)
              ? { id, name: id, toolSupport: "unknown" as const }
              : null;
          })
          .filter(isPresent);
      },
    );
    return { models };
  }

  if (backend === "anthropic") {
    const data: unknown[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", "100");
      if (afterId) url.searchParams.set("after_id", afterId);
      const response = await fetch(url, {
        headers: {
          "x-api-key": credentials.apiKey,
          "anthropic-version": "2023-06-01",
        },
      });
      if (!response.ok) {
        throw new Error(`Anthropic catalog failed (${response.status})`);
      }
      const json = (await response.json()) as {
        data?: unknown;
        has_more?: boolean;
        last_id?: string;
      };
      if (Array.isArray(json.data)) data.push(...json.data);
      if (!json.has_more || !json.last_id) break;
      afterId = json.last_id;
    }
    return {
      models: data
        .map((item) => {
          const id = String((item as { id?: string })?.id ?? "").trim();
          const name = String(
            (item as { display_name?: string })?.display_name ?? id,
          );
          return id ? { id, name, toolSupport: "supported" as const } : null;
        })
        .filter(isPresent),
    };
  }

  if (backend === "google") {
    const data: unknown[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const url = new URL(
        "https://generativelanguage.googleapis.com/v1beta/models",
      );
      url.searchParams.set("key", credentials.apiKey);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Google catalog failed (${response.status})`);
      }
      const json = (await response.json()) as {
        models?: unknown;
        nextPageToken?: string;
      };
      if (Array.isArray(json.models)) data.push(...json.models);
      if (!json.nextPageToken) break;
      pageToken = json.nextPageToken;
    }
    return {
      models: data
        .map((item) => {
          const record = item as {
            name?: string;
            displayName?: string;
            supportedGenerationMethods?: unknown;
          };
          if (
            !Array.isArray(record.supportedGenerationMethods) ||
            !record.supportedGenerationMethods.includes("generateContent")
          ) {
            return null;
          }
          const rawId = String(record.name ?? "").trim();
          const id = rawId.replace(/^models\//, "");
          const name = String(
            record.displayName ?? id,
          );
          return id ? { id, name, toolSupport: "unknown" as const } : null;
        })
        .filter(isPresent),
    };
  }

  if (backend === "openrouter") {
    const models = await fetchJsonModels(
      `${OPENROUTER_API_BASE}/models`,
      credentials.apiKey,
      (json) => {
        const data = (json as { data?: unknown }).data;
        if (!Array.isArray(data)) return [];
        return data
          .map((item) => {
            const record = item as {
              id?: string;
              name?: string;
              architecture?: { input_modalities?: unknown };
              supported_parameters?: unknown;
            };
            const id = String(record.id ?? "").trim();
            const name = String(record.name ?? id);
            const modalities = record.architecture?.input_modalities;
            if (Array.isArray(modalities) && !modalities.includes("text")) {
              return null;
            }
            const params = record.supported_parameters;
            if (Array.isArray(params) && !params.includes("tools")) return null;
            return id
              ? {
                  id,
                  name,
                  toolSupport: Array.isArray(params)
                    ? ("supported" as const)
                    : ("unknown" as const),
                }
              : null;
          })
          .filter(isPresent);
      },
    );
    return { models };
  }

  if (backend === "openai_compatible") {
    const baseUrl = compatibleCatalogBaseUrl(instance.baseUrl);
    const models = await fetchJsonModels(
      `${baseUrl}/models`,
      credentials.apiKey,
      (json) => {
        const data = (json as { data?: unknown }).data;
        if (!Array.isArray(data)) return [];
        return data
          .map((item) => {
            const id = String((item as { id?: string })?.id ?? "").trim();
            return id
              ? { id, name: id, toolSupport: "unknown" as const }
              : null;
          })
          .filter(isPresent);
      },
    );
    return { models };
  }

  return { models: [] };
}

export async function startAgentChatStream(input: {
  userData: string;
  projectPath: string;
  streamId: string;
  body: unknown;
  sender: WebContents;
}): Promise<{ streamId: string }> {
  const streamId = input.streamId.trim();
  if (!streamId) throw new Error("Stream id is required");
  if (activeStreams.has(streamId)) {
    throw new Error("Agent stream id is already active");
  }
  const controller = new AbortController();
  let resolveDone!: () => void;
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  activeStreams.set(streamId, {
    controller,
    projectPath: input.projectPath,
    webContentsId: input.sender.id,
    done,
  });

  void (async () => {
    let finishedSent = false;
    const send = (event: import("../../shared/agent").AgentStreamEvent) => {
      if (input.sender.isDestroyed()) return;
      input.sender.send("agent:stream", { streamId, event });
      if (event.type === "finished") finishedSent = true;
    };
    try {
      const { runAgentChatStreaming } = await import("./chatLoop");
      for await (const event of runAgentChatStreaming({
        userData: input.userData,
        projectPath: input.projectPath,
        webContentsId: input.sender.id,
        body: input.body,
        abortSignal: controller.signal,
        rendererCapabilities: getAgentRendererHostCapabilities({
          projectPath: input.projectPath,
          webContentsId: input.sender.id,
        }),
        executeRendererTool: (name, args, signal) =>
          dispatchAgentRendererTool({
            projectPath: input.projectPath,
            webContentsId: input.sender.id,
            toolName: name,
            args,
            signal,
          }),
      })) {
        if (input.sender.isDestroyed()) break;
        send(event);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        send({
          type: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (!finishedSent) send({ type: "finished" });
      activeStreams.delete(streamId);
      resolveDone();
    }
  })();

  return { streamId };
}

export function cancelAgentChatStream(input: {
  streamId: string;
  projectPath: string;
  webContentsId: number;
}): { canceled: true } {
  const active = activeStreams.get(input.streamId);
  if (!active) return { canceled: true };
  if (
    active.webContentsId !== input.webContentsId ||
    active.projectPath !== input.projectPath
  ) {
    throw new Error("Agent stream does not belong to this project window");
  }
  active.controller.abort();
  return { canceled: true };
}

export function disposeAgentStreamsForWebContents(webContentsId: number): void {
  for (const active of activeStreams.values()) {
    if (active.webContentsId === webContentsId) active.controller.abort();
  }
  clearPendingConfirmationsForWebContents(webContentsId);
}

export async function disposeAgentStateForProject(projectPath: string): Promise<void> {
  const streams = [...activeStreams.values()].filter(
    (active) => active.projectPath === projectPath,
  );
  for (const active of streams) active.controller.abort();
  clearPendingConfirmationsForProject(projectPath);
  disposeAgentRendererBridgeForProject(projectPath);
  await Promise.allSettled(streams.map((active) => active.done));
}

export async function disposeAllAgentState(): Promise<void> {
  const streams = [...activeStreams.values()];
  for (const active of streams) active.controller.abort();
  await Promise.allSettled(streams.map((active) => active.done));
}
