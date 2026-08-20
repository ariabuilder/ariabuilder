import { type IpcMainInvokeEvent } from "../electron-api";
import { addRecent, cancelProjectCreation, consumeApprovedProjectOpen, createAstroProject, listRecents, isRecentProject, openProjectDialog, pickNewProjectDir, removeRecent, type CreateAstroOpts } from "../project";
import { closeSession, installSessionDeps, listSessions, openSession, requireOpenSession, requireSessionOwner, sessionOwnerCount, startSessionRuntime, restartSessionRuntime, stopSessionRuntime } from "../sessions";
import { consumeProjectTrustChallenge, createProjectTrustChallenge, isProjectTrusted, revokeProjectTrust, trustProject } from "../projectTrust";
import { disposeTerminalsForOwnerCwd } from "../terminal";
import { disposeAgentStateForProject } from "../agent";
import { removeProjectThumbs } from "../thumbs";
import { canonicalDirectory } from "../pathSafety";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerProjectIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle("open_project_dialog", (event: IpcMainInvokeEvent) =>
      openProjectDialog(context.senderWindow(event)),
    );

  handle("pick_new_project_dir", (event: IpcMainInvokeEvent) =>
      pickNewProjectDir(context.senderWindow(event)),
    );

  handle(
      "create_astro_project",
      async (event: IpcMainInvokeEvent, opts: CreateAstroOpts) => {
        await createAstroProject(context.senderWindow(event), opts);
        trustProject(context.userDataPath, opts.dir, "aria-created");
      },
    );

  handle(
      "cancel_create_astro_project",
      (event: IpcMainInvokeEvent, jobId?: string) =>
        cancelProjectCreation(jobId, event.sender.id),
    );

  handle("list_recents", () => listRecents(context.userDataPath));

  handle(
      "open_project_window",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const canonical = canonicalDirectory(projectPath);
        const alreadyOpen = listSessions().some((session) => session.path === canonical);
        if (!alreadyOpen && !isRecentProject(context.userDataPath, canonical)) {
          throw new Error("Open the project through the Aria dialog first");
        }
        context.createWindow(canonical);
        return { ok: true as const };
      },
    );

  handle(
      "add_recent",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        requireOpenSession(projectPath);
        addRecent(context.userDataPath, projectPath);
        context.refreshApplicationMenu();
      },
    );

  handle(
      "remove_recent",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        removeRecent(context.userDataPath, projectPath);
        context.refreshApplicationMenu();
        if (typeof projectPath === "string" && projectPath.trim()) {
          removeProjectThumbs(context.userDataPath, projectPath);
        }
      },
    );

  handle("sessions:list", () => listSessions());

  handle(
      "sessions:open",
      async (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const canonical = canonicalDirectory(projectPath);
        const alreadyOpen = listSessions().some((session) => session.path === canonical);
        if (!alreadyOpen && !consumeApprovedProjectOpen(canonical) && !isRecentProject(context.userDataPath, canonical)) {
          throw new Error("Open the project through the Aria dialog first");
        }
        if (!isProjectTrusted(context.userDataPath, canonical)) {
          return {
            status: "trust_required" as const,
            challenge: createProjectTrustChallenge({
              projectPath: canonical,
              ownerId: event.sender.id,
            }),
          };
        }
        const session = await openSession(canonical, event.sender.id);
        addRecent(context.userDataPath, session.path);
        context.refreshApplicationMenu();
        return { status: "opened" as const, session };
      },
    );

  handle(
      "sessions:confirmTrustAndOpen",
      async (event: IpcMainInvokeEvent, challengeId: string) => {
        if (typeof challengeId !== "string" || !challengeId.trim()) {
          throw new Error("Project trust request is required");
        }
        const projectPath = consumeProjectTrustChallenge({
          userData: context.userDataPath,
          challengeId,
          ownerId: event.sender.id,
        });
        const session = await openSession(projectPath, event.sender.id);
        addRecent(context.userDataPath, session.path);
        context.refreshApplicationMenu();
        return { status: "opened" as const, session };
      },
    );

  handle(
      "sessions:revokeTrust",
      (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const canonical = canonicalDirectory(projectPath);
        const owners = sessionOwnerCount(canonical);
        if (owners > 1) {
          return { status: "in_use" as const, projectPath: canonical };
        }
        if (owners === 1) requireSessionOwner(canonical, event.sender.id);
        return revokeProjectTrust(context.userDataPath, canonical);
      },
    );

  handle(
      "sessions:close",
      async (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireSessionOwner(projectPath, event.sender.id);
        disposeTerminalsForOwnerCwd(event.sender.id, root);
        if (sessionOwnerCount(root) <= 1) await disposeAgentStateForProject(root);
        return closeSession(root, event.sender.id);
      },
    );

  handle("sessions:start", (event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return startSessionRuntime(requireSessionOwner(projectPath, event.sender.id));
    });

  handle("sessions:stop", (event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return stopSessionRuntime(requireSessionOwner(projectPath, event.sender.id));
    });

  handle("sessions:restart", (event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return restartSessionRuntime(requireSessionOwner(projectPath, event.sender.id));
    });

  handle(
      "sessions:installDeps",
      (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return installSessionDeps(requireSessionOwner(projectPath, event.sender.id));
      },
    );
}
