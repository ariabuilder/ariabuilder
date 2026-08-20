import { type IpcMainInvokeEvent } from "../electron-api";
import { requireSessionOwner } from "../sessions";
import { createTerminalSession, disposeTerminal, resizeTerminal, restartTerminalSession, writeTerminal } from "../terminal";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerTerminalIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "terminal:create",
      (
        event: IpcMainInvokeEvent,
        projectPath: string,
        cols?: number,
        rows?: number,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const cwd = requireSessionOwner(projectPath, event.sender.id);
        return createTerminalSession({
          cwd,
          cols: typeof cols === "number" ? cols : undefined,
          rows: typeof rows === "number" ? rows : undefined,
          webContents: event.sender,
        });
      },
    );

  handle(
      "terminal:write",
      (event: IpcMainInvokeEvent, id: string, data: string) => {
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("Terminal session id is required");
        }
        writeTerminal(id, data, event.sender.id);
        return { ok: true as const };
      },
    );

  handle(
      "terminal:resize",
      (
        event: IpcMainInvokeEvent,
        id: string,
        cols: number,
        rows: number,
      ) => {
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("Terminal session id is required");
        }
        if (typeof cols !== "number" || typeof rows !== "number") {
          throw new Error("Terminal cols and rows are required");
        }
        resizeTerminal(id, cols, rows, event.sender.id);
        return { ok: true as const };
      },
    );

  handle("terminal:dispose", (event: IpcMainInvokeEvent, id: string) => {
      if (typeof id !== "string" || !id.trim()) {
        throw new Error("Terminal session id is required");
      }
      disposeTerminal(id, event.sender.id);
      return { ok: true as const };
    });

  handle(
      "terminal:restart",
      (
        event: IpcMainInvokeEvent,
        id: string,
        cols?: number,
        rows?: number,
      ) => {
        if (typeof id !== "string" || !id.trim()) {
          throw new Error("Terminal session id is required");
        }
        return restartTerminalSession({
          id,
          cols: typeof cols === "number" ? cols : undefined,
          rows: typeof rows === "number" ? rows : undefined,
          webContents: event.sender,
        });
      },
    );
}
