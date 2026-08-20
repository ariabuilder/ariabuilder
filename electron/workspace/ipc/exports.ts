import fs from "node:fs";
import { BrowserWindow, type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { createSiteExport, listSiteExports, deleteSiteExport, revealSiteExport, inventorySiteExport, getSiteExportBytes } from "../../export";
import { dialog } from "../../electron-api";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerExportsIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "workspace:site_export_create",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input?: { ttlMinutes?: number; selection?: unknown },
      ) => {
        return createSiteExport(requireOpenSession(projectPath), input as never);
      },
    );

  handle(
      "workspace:site_export_list",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        return listSiteExports(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:site_export_delete",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { id: string },
      ) => {
        deleteSiteExport(requireOpenSession(projectPath), input);
        return { ok: true as const };
      },
    );

  handle(
      "workspace:site_export_reveal",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { id: string },
      ) => {
        revealSiteExport(requireOpenSession(projectPath), input);
        return { ok: true as const };
      },
    );

  handle(
      "workspace:site_export_save_as",
      async (
        event: IpcMainInvokeEvent,
        projectPath: string,
        input: { id: string },
      ) => {
        const root = requireOpenSession(projectPath);
        const packed = getSiteExportBytes(root, input.id);
        if (!packed) throw new Error("Export archive not found");
        const win = BrowserWindow.fromWebContents(event.sender);
        const result = win
          ? await dialog.showSaveDialog(win, {
              defaultPath: packed.record.filename,
              filters: [{ name: "ZIP", extensions: ["zip"] }],
            })
          : await dialog.showSaveDialog({
              defaultPath: packed.record.filename,
              filters: [{ name: "ZIP", extensions: ["zip"] }],
            });
        if (result.canceled || !result.filePath) {
          return { ok: true as const };
        }
        fs.writeFileSync(result.filePath, packed.bytes);
        return { ok: true as const, path: result.filePath };
      },
    );

  handle(
      "workspace:site_export_inventory",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        return inventorySiteExport(requireOpenSession(projectPath));
      },
    );
}
