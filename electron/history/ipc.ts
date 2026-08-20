import { type IpcMainInvokeEvent } from "../electron-api";
import { requireOpenSession } from "../sessions";
import { listProjectHistory, redoProjectHistory, restoreProjectHistory, undoProjectHistory } from "../mutations";
import type { HistoryRestoreDirection } from "../../shared/history";
import { searchProject } from "../search";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerHistoryIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "history:list",
      (_event: IpcMainInvokeEvent, projectPath: string) =>
        listProjectHistory(requireOpenSession(projectPath)),
    );

  handle(
      "search:project",
      (_event: IpcMainInvokeEvent, projectPath: string, input: unknown) =>
        searchProject(requireOpenSession(projectPath), input),
    );

  handle(
      "history:undo",
      (_event: IpcMainInvokeEvent, projectPath: string) =>
        undoProjectHistory(requireOpenSession(projectPath)),
    );

  handle(
      "history:redo",
      (_event: IpcMainInvokeEvent, projectPath: string) =>
        redoProjectHistory(requireOpenSession(projectPath)),
    );

  handle(
      "history:restore",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        recordId: string,
        direction: HistoryRestoreDirection,
      ) => {
        if (typeof recordId !== "string" || !recordId.trim()) {
          throw new Error("History record id is required");
        }
        return restoreProjectHistory(
          requireOpenSession(projectPath),
          recordId.trim(),
          direction,
        );
      },
    );
}
