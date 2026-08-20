import { type IpcMainInvokeEvent } from "../electron-api";
import { requireOpenSession } from "../sessions";
import { checkoutBranch, commitAll, createBranch, diffFile, getGitStatus, initRepo, listBranches, pushUpstream } from "../git";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerGitIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle("git:status", (_event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return getGitStatus(requireOpenSession(projectPath));
    });

  handle(
      "git:commit",
      (_event: IpcMainInvokeEvent, projectPath: string, message: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof message !== "string") {
          throw new Error("Commit message is required");
        }
        return commitAll(requireOpenSession(projectPath), message);
      },
    );

  handle("git:push", (_event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return pushUpstream(requireOpenSession(projectPath));
    });

  handle("git:listBranches", (_event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return listBranches(requireOpenSession(projectPath));
    });

  handle(
      "git:checkout",
      (_event: IpcMainInvokeEvent, projectPath: string, branch: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof branch !== "string" || !branch.trim()) {
          throw new Error("Branch name is required");
        }
        return checkoutBranch(requireOpenSession(projectPath), branch);
      },
    );

  handle(
      "git:createBranch",
      (_event: IpcMainInvokeEvent, projectPath: string, branch: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof branch !== "string" || !branch.trim()) {
          throw new Error("Branch name is required");
        }
        return createBranch(requireOpenSession(projectPath), branch);
      },
    );

  handle("git:init", (_event: IpcMainInvokeEvent, projectPath: string) => {
      if (typeof projectPath !== "string" || !projectPath.trim()) {
        throw new Error("Project path is required");
      }
      return initRepo(requireOpenSession(projectPath));
    });

  handle(
      "git:diffFile",
      (_event: IpcMainInvokeEvent, projectPath: string, filePath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof filePath !== "string" || !filePath.trim()) {
          throw new Error("File path is required");
        }
        return diffFile(requireOpenSession(projectPath), filePath);
      },
    );
}
