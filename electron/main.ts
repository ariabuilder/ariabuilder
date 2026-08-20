import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApplicationMenuController } from "./app/menu";
import { createShutdownController } from "./app/shutdown";
import { createWindowManager } from "./app/windowManager";
import { BRAND_NAME } from "./brand";
import { app, session } from "./electron-api";
import { createIpcRegistrar } from "./ipc/registrar";
import { registerAllIpc } from "./ipc/registerAll";
import {
  registerAriaMediaProtocolHandler,
  registerAriaMediaSchemePrivileges,
} from "./mediaProtocol";
import { installPreviewFrameBypass } from "./previewFramePolicy";
import { listRecents } from "./project";
import { trustProject } from "./projectTrust";
import { onProjectChange, onSessionUpdate } from "./sessions";
import {
  setComponentThumbReadyHandler,
  setLayoutThumbReadyHandler,
  setPageThumbReadyHandler,
} from "./thumbs";
import { createApplicationUpdater } from "./updater";
import type { UpdateController } from "./updaterController";

const electronDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.join(electronDir, "..");
const isDev = !app.isPackaged;
const DEV_URL =
  process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:1420/";

// These calls must remain before app readiness.
app.setName(BRAND_NAME);
const userDataPath = app.getPath("userData");
if (process.platform === "win32") {
  app.setAppUserModelId("com.ariabuilder.app");
}
registerAriaMediaSchemePrivileges();

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  if (
    process.env.ARIA_SMOKE_IPC === "1" ||
    process.env.ARIA_SMOKE_RENDERER === "1"
  ) {
    console.error(
      "ARIA_SMOKE_FAIL another Aria instance holds the single-instance lock; quit the running app and retry",
    );
    app.exit(1);
  } else {
    app.quit();
  }
}

let applicationUpdater: UpdateController | null = null;
let readIsQuitting = (): boolean => false;

const windowManager = createWindowManager({
  electronDir,
  appRoot,
  isDev,
  devUrl: DEV_URL,
  userDataPath,
  isQuitting: () => readIsQuitting(),
});

const shutdownController = createShutdownController({
  hasSingleInstanceLock,
  broadcast: windowManager.broadcast,
  getUpdater: () => applicationUpdater,
});
readIsQuitting = shutdownController.isQuitting;

const menuController = createApplicationMenuController({
  appRoot,
  userDataPath,
  sendCommand: windowManager.sendAppMenuCommand,
  checkForUpdates: () => {
    void applicationUpdater?.checkForUpdates(true);
  },
});

if (hasSingleInstanceLock) {
  app.on("second-instance", windowManager.focusAnyAppWindow);
}

setPageThumbReadyHandler((payload) => {
  windowManager.broadcast("thumbs:pageReady", payload);
});
setComponentThumbReadyHandler((payload) => {
  windowManager.broadcast("thumbs:componentReady", payload);
});
setLayoutThumbReadyHandler((payload) => {
  windowManager.broadcast("thumbs:layoutReady", payload);
});

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  menuController.configureAboutPanel();
  menuController.refresh();
  installPreviewFrameBypass(session.defaultSession);
  registerAriaMediaProtocolHandler();

  const registrar = createIpcRegistrar({
    appRoot,
    isDev,
    devUrl: DEV_URL,
    rendererToken: process.env.ARIA_RENDERER_TOKEN,
    trustedRenderers: windowManager.trustedRenderers,
    isAppWindow: windowManager.isAppWindow,
    isQuitting: shutdownController.isQuitting,
  });
  registerAllIpc(registrar, {
    userDataPath,
    getVersion: () => app.getVersion(),
    createWindow: windowManager.createWindow,
    refreshApplicationMenu: menuController.refresh,
    senderWindow: windowManager.senderWindow,
  });

  onSessionUpdate((projectSession) => {
    windowManager.broadcast("session:updated", projectSession);
  });
  onProjectChange((projectPath, change) => {
    windowManager.broadcast("project:changed", projectPath, change);
  });

  if (process.env.ARIA_SMOKE_IPC === "1") {
    console.log(
      `ARIA_SMOKE version=${app.getVersion()} recents=${listRecents(userDataPath).length}`,
    );
    app.exit(0);
    return;
  }

  applicationUpdater = createApplicationUpdater({
    requestRestart: shutdownController.requestRestartForUpdate,
  });
  const smokeProject = process.env.ARIA_SMOKE_OPEN?.trim();
  if (smokeProject) trustProject(userDataPath, smokeProject, "smoke");
  windowManager.createWindow(smokeProject);
  app.on("activate", windowManager.handleActivate);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", shutdownController.handleBeforeQuit);
