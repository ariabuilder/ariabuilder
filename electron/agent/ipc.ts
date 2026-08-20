import { type IpcMainInvokeEvent } from "../electron-api";
import { findOpenSessionPath, requireOpenSession } from "../sessions";
import { cancelAgentChatStream, clearProviderCredentials, confirmInsecureProviderCredentials, getAgentAvailability, getAgentSettings, getCredentialStatuses, listCatalogModels, patchAgentSettings, removeInferenceProvider, registerAgentRendererHost, resolveAgentRendererTool, setProviderCredentials, startAgentChatStream } from "./";
import { parseAgentRendererHostRegistrationArgs, type CredentialBackendId } from "../../shared/agent";
import { canonicalDirectory } from "../pathSafety";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerAgentIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "agent:getAvailability",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return getAgentAvailability(
          context.userDataPath,
          requireOpenSession(projectPath),
        );
      },
    );

  handle(
      "agent:getSettings",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return getAgentSettings(
          context.userDataPath,
          requireOpenSession(projectPath),
        );
      },
    );

  handle(
      "agent:patchSettings",
      (_event: IpcMainInvokeEvent, projectPath: string, patch: unknown) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return patchAgentSettings(
          context.userDataPath,
          requireOpenSession(projectPath),
          patch,
        );
      },
    );

  handle(
      "agent:setProviderCredentials",
      (_event: IpcMainInvokeEvent, input: unknown) =>
        setProviderCredentials(context.userDataPath, input),
    );

  handle(
      "agent:clearProviderCredentials",
      (_event: IpcMainInvokeEvent, backend: string, instanceId?: string) => {
        if (typeof backend !== "string" || !backend.trim()) {
          throw new Error("Backend is required");
        }
        return clearProviderCredentials(
          context.userDataPath,
          backend as CredentialBackendId,
          instanceId,
        );
      },
    );

  handle(
      "agent:confirmInsecureProviderCredentials",
      (
        _event: IpcMainInvokeEvent,
        backend: string,
        instanceId: string | undefined,
        confirmation: string,
      ) => {
        if (typeof backend !== "string" || !backend.trim()) {
          throw new Error("Backend is required");
        }
        return confirmInsecureProviderCredentials(
          context.userDataPath,
          backend as CredentialBackendId,
          instanceId,
          confirmation,
        );
      },
    );

  handle(
      "agent:removeInferenceProvider",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        instanceId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof instanceId !== "string" || !instanceId.trim()) {
          throw new Error("Provider instance id is required");
        }
        return removeInferenceProvider(
          context.userDataPath,
          requireOpenSession(projectPath),
          instanceId,
        );
      },
    );

  handle("agent:getCredentialStatuses", () =>
      getCredentialStatuses(context.userDataPath),
    );

  handle(
      "agent:listCatalogModels",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        instanceId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof instanceId !== "string" || !instanceId.trim()) {
          throw new Error("Provider instance id is required");
        }
        return listCatalogModels(
          context.userDataPath,
          requireOpenSession(projectPath),
          instanceId,
        );
      },
    );

  handle(
      "agent:startChat",
      async (
        event: IpcMainInvokeEvent,
        projectPath: string,
        streamId: string,
        body: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof streamId !== "string" || !streamId.trim()) {
          throw new Error("Stream id is required");
        }
        return startAgentChatStream({
          userData: context.userDataPath,
          projectPath: requireOpenSession(projectPath),
          streamId,
          body,
          sender: event.sender,
        });
      },
    );

  handle(
      "agent:cancelChat",
      (
        event: IpcMainInvokeEvent,
        projectPath: string,
        streamId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof streamId !== "string" || !streamId.trim()) {
          throw new Error("Stream id is required");
        }
        return cancelAgentChatStream({
          streamId,
          projectPath: requireOpenSession(projectPath),
          webContentsId: event.sender.id,
        });
      },
    );

  handle(
      "agent:registerRendererHost",
      (
        event: IpcMainInvokeEvent,
        projectPathOrInput: unknown,
        legacyActive?: unknown,
        scope?: unknown,
        registrationId?: unknown,
      ) => {
        const parsed = parseAgentRendererHostRegistrationArgs(
          projectPathOrInput,
          legacyActive,
          scope,
          registrationId,
        );
        const projectPath = parsed.kind === "scoped"
          ? parsed.registration.projectPath
          : parsed.projectPath;
        const active = parsed.kind === "scoped"
          ? parsed.registration.active
          : parsed.active;
        const root = active
          ? findOpenSessionPath(projectPath)
          : canonicalDirectory(projectPath);
        if (!root) return { registered: false };
        if (parsed.kind === "legacy") {
          const workspace = registerAgentRendererHost({
            projectPath: root,
            webContents: event.sender,
            scope: "workspace",
            registrationId: `legacy-workspace:${event.sender.id}`,
            active,
          });
          const document = registerAgentRendererHost({
            projectPath: root,
            webContents: event.sender,
            scope: "document",
            registrationId: `legacy-document:${event.sender.id}`,
            active,
          });
          return { registered: workspace.registered || document.registered };
        }
        const input = parsed.registration;
        return registerAgentRendererHost({
          projectPath: root,
          webContents: event.sender,
          scope: input.scope,
          registrationId: input.registrationId,
          active: input.active,
        });
      },
    );

  handle(
      "agent:rendererToolResult",
      (event: IpcMainInvokeEvent, response: unknown) =>
        resolveAgentRendererTool(event.sender.id, response),
    );
}
