import path from "node:path";
import type { AppMenuCommand } from "../../shared/appMenu";
import { matchAppShortcutId } from "../../shared/appShortcuts";
import { disposeAgentRendererBridgeForWebContents, disposeAgentStateForProject, disposeAgentStreamsForWebContents } from "../agent";
import { BRAND_NAME } from "../brand";
import {
  BrowserWindow,
  nativeTheme,
  shell,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
} from "../electron-api";
import { discardProjectTrustChallengesForOwner } from "../projectTrust";
import { shouldAllowWindowRedirect } from "../previewFramePolicy";
import { isAllowedExternalUrl, isTrustedAppUrl } from "../security";
import {
  closeSession,
  listSessionPathsForOwner,
  listSessions,
  sessionOwnerCount,
  stopAllSessions,
} from "../sessions";
import { disposeTerminalsForWebContents } from "../terminal";
import { installSessionPermissionPolicy } from "./sessionPermissions";
import { createRendererSmokeController } from "./smoke";

type WindowManagerOptions = {
  electronDir: string;
  appRoot: string;
  isDev: boolean;
  devUrl: string;
  userDataPath: string;
  isQuitting(): boolean;
};

export interface WindowManager {
  readonly trustedRenderers: Set<number>;
  isAppWindow(win: BrowserWindowType): boolean;
  focusAnyAppWindow(): void;
  sendAppMenuCommand(command: AppMenuCommand): void;
  broadcast(channel: string, ...args: unknown[]): void;
  senderWindow(event: IpcMainInvokeEvent): BrowserWindowType | null;
  createWindow(initialProject?: string): BrowserWindowType;
  handleActivate(): void;
}

export function createWindowManager(options: WindowManagerOptions): WindowManager {
  let mainWindow: BrowserWindowType | null = null;
  let lastWindowCleanupTimer: NodeJS.Timeout | null = null;
  const appWindows = new Set<BrowserWindowType>();
  const trustedRenderers = new Set<number>();
  const smoke = createRendererSmokeController({
    userDataPath: options.userDataPath,
  });

  const isAppWindow = (win: BrowserWindowType): boolean => appWindows.has(win);

  const findPreferredWindow = (): BrowserWindowType | null => {
    const focused = BrowserWindow.getFocusedWindow();
    return (
      (focused && isAppWindow(focused) && !focused.isDestroyed() ? focused : null) ??
      (mainWindow && !mainWindow.isDestroyed() ? mainWindow : null) ??
      [...appWindows].find((candidate) => !candidate.isDestroyed()) ??
      null
    );
  };

  const focusAnyAppWindow = (): void => {
    const win = findPreferredWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  };

  const broadcast = (channel: string, ...args: unknown[]): void => {
    for (const win of appWindows) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
      try {
        win.webContents.send(channel, ...args);
      } catch {
        // The renderer may disappear while a child process is shutting down.
      }
    }
  };

  const releaseSessionsForOwner = async (ownerId: number): Promise<void> => {
    discardProjectTrustChallengesForOwner(ownerId);
    for (const projectPath of listSessionPathsForOwner(ownerId)) {
      if (sessionOwnerCount(projectPath) <= 1) {
        await disposeAgentStateForProject(projectPath);
      }
      await closeSession(projectPath, ownerId);
    }
  };

  const scheduleLastWindowCleanup = (): void => {
    if (options.isQuitting()) return;
    if (lastWindowCleanupTimer) clearTimeout(lastWindowCleanupTimer);
    lastWindowCleanupTimer = setTimeout(() => {
      lastWindowCleanupTimer = null;
      if (appWindows.size === 0 && !options.isQuitting()) {
        void stopAllSessions();
      }
    }, 500);
  };

  function createWindow(initialProject?: string): BrowserWindowType {
    const bootProject = initialProject?.trim() || undefined;
    const win = new BrowserWindow({
      title: BRAND_NAME,
      width: 1440,
      height: 900,
      show: false,
      backgroundColor: nativeTheme.shouldUseDarkColors ? "#0d0d0d" : "#e4e4e4",
      ...(process.platform === "darwin"
        ? {
            titleBarStyle: "hiddenInset" as const,
            trafficLightPosition: { x: 16, y: 14 },
          }
        : {}),
      webPreferences: {
        preload: path.join(options.electronDir, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });

    installSessionPermissionPolicy(win.webContents.session, options);

    appWindows.add(win);
    if (!mainWindow || mainWindow.isDestroyed()) mainWindow = win;
    const contentsId = win.webContents.id;

    win.once("ready-to-show", () => {
      if (!win.isDestroyed()) win.show();
    });
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame) return;
        console.error(
          `Failed to load ${validatedURL}: ${errorDescription} (${errorCode})`,
        );
        if (!win.isDestroyed()) win.show();
      },
    );
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error("Renderer crashed:", details.reason, details.exitCode);
      void releaseSessionsForOwner(contentsId);
    });
    win.webContents.on("did-start-navigation", (details) => {
      if (details.isMainFrame) trustedRenderers.delete(contentsId);
    });
    win.webContents.on("console-message", (event) => {
      if (event.level === "error" || event.level === "warning") {
        console.error(`[renderer:${event.level}]`, event.message);
      }
    });
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternalUrl(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    win.webContents.on("will-navigate", (event, url) => {
      if (
        !isTrustedAppUrl(url, {
          appRoot: options.appRoot,
          isDev: options.isDev,
          devUrl: options.devUrl,
        })
      ) {
        event.preventDefault();
      }
    });
    win.webContents.on("will-redirect", (event) => {
      const trustedMainFrameUrl = isTrustedAppUrl(event.url, {
        appRoot: options.appRoot,
        isDev: options.isDev,
        devUrl: options.devUrl,
      });
      const activePreviewUrls = listSessions()
        .filter((projectSession) => projectSession.live)
        .map((projectSession) => projectSession.previewUrl);
      if (
        !shouldAllowWindowRedirect({
          isMainFrame: event.isMainFrame,
          destinationUrl: event.url,
          trustedMainFrameUrl,
          activePreviewUrls,
        })
      ) {
        event.preventDefault();
      }
    });
    win.on("closed", () => {
      void releaseSessionsForOwner(contentsId);
      disposeTerminalsForWebContents(contentsId);
      disposeAgentStreamsForWebContents(contentsId);
      disposeAgentRendererBridgeForWebContents(contentsId);
      appWindows.delete(win);
      trustedRenderers.delete(contentsId);
      if (mainWindow === win) {
        mainWindow =
          [...appWindows].find((candidate) => !candidate.isDestroyed()) ?? null;
      }
      scheduleLastWindowCleanup();
    });

    const notifyFullscreen = (): void => {
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      try {
        win.webContents.send("window:fullscreen", win.isFullScreen());
      } catch {
        // Window may be tearing down.
      }
    };
    win.on("enter-full-screen", notifyFullscreen);
    win.on("leave-full-screen", notifyFullscreen);
    win.webContents.on("did-finish-load", notifyFullscreen);

    win.webContents.on("before-input-event", (event, input) => {
      const primaryModifierKey =
        process.platform === "darwin" ? "Meta" : "Control";
      const isPrimaryModifierKey =
        input.key === primaryModifierKey ||
        input.code.startsWith(primaryModifierKey);
      if (
        isPrimaryModifierKey &&
        (input.type === "keyDown" || input.type === "keyUp") &&
        !input.isAutoRepeat
      ) {
        try {
          win.webContents.send(
            "window:primary-modifier",
            input.type === "keyDown",
          );
        } catch {
          // Window may be tearing down.
        }
      }
      if (input.type !== "keyDown" || input.isAutoRepeat) return;
      const id = matchAppShortcutId(
        {
          type: input.type,
          key: input.key,
          code: input.code,
          control: input.control,
          meta: input.meta,
          alt: input.alt,
          shift: input.shift,
        },
        process.platform,
      );
      if (!id) return;
      event.preventDefault();
      if (win.isDestroyed() || win.webContents.isDestroyed()) return;
      try {
        win.webContents.send("window:shortcut", id);
      } catch {
        // Window may be tearing down.
      }
    });

    // The packaged smoke controller owns project/session startup. Loading the
    // same project in the renderer would start a second runtime and schedule a
    // competing thumbnail capture, making the smoke nondeterministic.
    const projectQuery = bootProject && !smoke.shouldRun()
      ? `project=${encodeURIComponent(bootProject)}`
      : null;
    const loadTarget =
      options.isDev && projectQuery
        ? `${options.devUrl}?${projectQuery}`
        : options.isDev
          ? options.devUrl
          : null;
    const afterLoad = async (): Promise<void> => {
      if (options.isDev && process.env.ARIA_DEBUG === "1") {
        win.webContents.openDevTools({ mode: "detach" });
      }
      await smoke.afterWindowLoad(win, bootProject);
    };
    const onLoadFailure = (label: string, error: unknown): void => {
      console.error(label, error);
      if (smoke.shouldRun()) smoke.fail(error);
      if (!win.isDestroyed()) win.show();
    };

    if (loadTarget) {
      void win
        .loadURL(loadTarget)
        .then(afterLoad)
        .catch((error: unknown) =>
          onLoadFailure(`Failed to load ${loadTarget}:`, error),
        );
    } else if (projectQuery) {
      void win
        .loadFile(path.join(options.electronDir, "../dist/index.html"), {
          search: projectQuery,
        })
        .then(afterLoad)
        .catch((error: unknown) =>
          onLoadFailure("Failed to load production UI:", error),
        );
    } else {
      void win
        .loadFile(path.join(options.electronDir, "../dist/index.html"))
        .then(afterLoad)
        .catch((error: unknown) =>
          onLoadFailure("Failed to load production UI:", error),
        );
    }
    return win;
  }

  const sendAppMenuCommand = (command: AppMenuCommand): void => {
    const win = findPreferredWindow();
    if (!win) {
      const created = createWindow();
      created.webContents.once("did-finish-load", () => {
        if (!created.isDestroyed() && !created.webContents.isDestroyed()) {
          created.webContents.send("app:menu-command", command);
        }
      });
      return;
    }
    if (!win.webContents.isDestroyed()) {
      win.webContents.send("app:menu-command", command);
    }
  };

  const handleActivate = (): void => {
    if (lastWindowCleanupTimer) {
      clearTimeout(lastWindowCleanupTimer);
      lastWindowCleanupTimer = null;
    }
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  };

  return {
    trustedRenderers,
    isAppWindow,
    focusAnyAppWindow,
    sendAppMenuCommand,
    broadcast,
    senderWindow: (event) => BrowserWindow.fromWebContents(event.sender),
    createWindow,
    handleActivate,
  };
}
