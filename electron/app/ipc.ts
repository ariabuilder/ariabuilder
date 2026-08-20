import fs from "node:fs";
import path from "node:path";
import { clipboard, shell, type IpcMainInvokeEvent } from "../electron-api";
import { readAppearancePrefs, writeAppearancePrefs } from "../appearance";
import type { AppAppearancePrefs } from "../../shared/appearance";
import { ARIA_COMPOSER_CLIPBOARD_MIME, type ComposerClipboardFormats } from "../../shared/composer/clipboard";
import { isRecentProject } from "../project";
import { listSessions } from "../sessions";
import { isAllowedExternalUrl } from "../security";
import { isPathInside } from "../pathSafety";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerAppIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "renderer:ready",
      () => ({ ok: true as const }),
      { beforeHandshake: true },
    );

  handle("appearance:get", () => readAppearancePrefs(context.userDataPath));

  handle(
      "appearance:set",
      (_event: IpcMainInvokeEvent, prefs: AppAppearancePrefs) => {
        if (!prefs || typeof prefs !== "object") {
          throw new Error("Appearance prefs are required");
        }
        return writeAppearancePrefs(context.userDataPath, prefs);
      },
    );

  handle("get_version", () => context.getVersion());

  handle("window:is_fullscreen", (event: IpcMainInvokeEvent) => {
      const win = context.senderWindow(event);
      return win?.isFullScreen() ?? false;
    });

  handle("window:close", (event: IpcMainInvokeEvent) => {
      const win = context.senderWindow(event);
      if (win && !win.isDestroyed()) win.close();
    });

  handle("window:set_fullscreen", (event: IpcMainInvokeEvent, fullscreen: boolean) => {
      const win = context.senderWindow(event);
      if (!win) return false;
      win.setFullScreen(Boolean(fullscreen));
      return win.isFullScreen();
    });

  handle(
      "clipboard:write_text",
      (_event: IpcMainInvokeEvent, text: string) => {
        clipboard.writeText(typeof text === "string" ? text : String(text ?? ""));
        return { ok: true as const };
      },
    );

  handle(
      "clipboard:write_composer",
      (_event: IpcMainInvokeEvent, formats: ComposerClipboardFormats) => {
        const text = typeof formats?.text === "string" ? formats.text : "";
        const html = typeof formats?.html === "string" ? formats.html : "";
        clipboard.write({ text, ...(html ? { html } : {}) });
        if (typeof formats?.aria === "string" && formats.aria) {
          clipboard.writeBuffer(
            ARIA_COMPOSER_CLIPBOARD_MIME,
            Buffer.from(formats.aria, "utf8"),
          );
        }
        return { ok: true as const };
      },
    );

  handle("clipboard:read_composer", () => {
      const aria = clipboard
        .readBuffer(ARIA_COMPOSER_CLIPBOARD_MIME)
        .toString("utf8");
      return {
        aria,
        html: clipboard.readHTML(),
        text: clipboard.readText(),
      } satisfies ComposerClipboardFormats;
    });

  handle(
      "shell:reveal_path",
      (_event: IpcMainInvokeEvent, targetPath: string) => {
        if (typeof targetPath !== "string" || !targetPath.trim()) {
          throw new Error("Path is required");
        }
        const absolute = path.resolve(targetPath);
        if (!fs.existsSync(absolute)) {
          throw new Error("Path not found");
        }
        const allowed = listSessions().some((session) => isPathInside(session.path, absolute));
        if (!allowed && !isRecentProject(context.userDataPath, absolute)) {
          throw new Error("Path is not inside an open or recent project");
        }
        shell.showItemInFolder(absolute);
        return { path: absolute };
      },
    );

  handle("open_url", async (_event, url: string) => {
      if (typeof url !== "string") {
        throw new Error("Invalid URL");
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new Error("Invalid URL");
      }
      if (!isAllowedExternalUrl(parsed.toString())) {
        throw new Error("Only http(s) URLs are allowed");
      }
      await shell.openExternal(parsed.toString());
    });
}
