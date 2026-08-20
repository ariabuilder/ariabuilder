import fs from "node:fs";
import path from "node:path";
import type { MenuItemConstructorOptions } from "electron";
import type { AppMenuCommand } from "../../shared/appMenu";
import {
  BRAND_NAME,
  BRAND_SITE_LABEL,
  BRAND_SITE_URL,
  brandCopyright,
} from "../brand";
import { app, Menu } from "../electron-api";
import { listRecents } from "../project";

type ApplicationMenuOptions = {
  appRoot: string;
  userDataPath: string;
  sendCommand(command: AppMenuCommand): void;
  checkForUpdates(): void;
};

export interface ApplicationMenuController {
  configureAboutPanel(): void;
  refresh(): void;
}

export function createApplicationMenuController(
  options: ApplicationMenuOptions,
): ApplicationMenuController {
  const resolveAppIconPath = (): string | null => {
    const candidates = [
      path.join(options.appRoot, ".github/aria-badge-light.png"),
      path.join(options.appRoot, "build/icons/icon.png"),
      path.join(options.appRoot, "build/icons/128x128@2x.png"),
      path.join(options.appRoot, "build/icons/128x128.png"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
  };

  const configureAboutPanel = (): void => {
    const iconPath = resolveAppIconPath();
    app.setAboutPanelOptions({
      applicationName: BRAND_NAME,
      applicationVersion: app.getVersion(),
      version: "",
      copyright: brandCopyright(),
      credits: BRAND_SITE_LABEL,
      website: BRAND_SITE_URL,
      ...(iconPath ? { iconPath } : {}),
    });
    // macOS masks the bundled .icns. dock.setIcon(png) would show a raw square.
  };

  const refresh = (): void => {
    const isMac = process.platform === "darwin";
    const checkForUpdatesItem = (): MenuItemConstructorOptions => ({
      label: isMac ? "Check for Updates…" : "Check for &Updates…",
      click: options.checkForUpdates,
    });
    const recents = listRecents(options.userDataPath);
    const recentItems: MenuItemConstructorOptions[] = recents.length
      ? recents.map((recent) => ({
          label: isMac ? recent.name : recent.name.replace(/&/g, "&&"),
          ...(isMac ? { sublabel: recent.path } : {}),
          click: () =>
            options.sendCommand({
              type: "open-recent",
              projectPath: recent.path,
            }),
        }))
      : [{ label: "No Recent Projects", enabled: false }];

    const template: MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: BRAND_NAME,
              submenu: [
                { role: "about" as const },
                { type: "separator" as const },
                checkForUpdatesItem(),
                { type: "separator" as const },
                { role: "services" as const },
                { type: "separator" as const },
                { role: "hide" as const },
                { role: "hideOthers" as const },
                { role: "unhide" as const },
                { type: "separator" as const },
                { role: "quit" as const },
              ],
            },
          ]
        : []),
      {
        label: isMac ? "File" : "&File",
        submenu: [
          {
            label: isMac ? "New Project" : "&New Project",
            accelerator: "CmdOrCtrl+N",
            click: () => options.sendCommand({ type: "new-project" }),
          },
          {
            label: isMac ? "Open Project…" : "&Open Project…",
            accelerator: "CmdOrCtrl+O",
            click: () => options.sendCommand({ type: "open-project" }),
          },
          { label: isMac ? "Open Recent" : "Open &Recent", submenu: recentItems },
          { type: "separator" },
          {
            label: isMac ? "Close Project / Window" : "&Close Project / Window",
            accelerator: "CmdOrCtrl+W",
            click: () => options.sendCommand({ type: "close-context" }),
          },
          ...(!isMac
            ? [{ type: "separator" as const }, { role: "quit" as const }]
            : []),
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
      ...(!isMac
        ? [
            {
              label: "&Help",
              submenu: [checkForUpdatesItem(), { role: "about" as const }],
            },
          ]
        : []),
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  };

  return { configureAboutPanel, refresh };
}
