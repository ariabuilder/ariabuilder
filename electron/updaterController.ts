export type UpdateVersionInfo = {
  version: string;
};

export type UpdateDialogOptions = {
  type: "info" | "error";
  title: string;
  message: string;
  detail?: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
  noLink?: boolean;
};

export type UpdateClientEvent =
  | "error"
  | "update-available"
  | "update-not-available"
  | "update-downloaded";

export type UpdateClient = {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on: (
    event: UpdateClientEvent,
    listener: (payload?: UpdateVersionInfo | Error) => void,
  ) => unknown;
  checkForUpdates: () => Promise<unknown>;
  downloadUpdate: () => Promise<unknown>;
  quitAndInstall: (isSilent?: boolean, isForceRunAfter?: boolean) => void;
};

export type UpdateController = {
  checkForUpdates: (manual?: boolean) => Promise<void>;
  installDownloadedUpdate: () => boolean;
};

type CreateUpdateControllerOptions = {
  updater: UpdateClient;
  isPackaged: boolean;
  currentVersion: string;
  showMessage: (
    options: UpdateDialogOptions,
  ) => Promise<{ response: number }>;
  requestRestart: () => void;
  log?: Pick<Console, "error" | "info">;
};

function versionFromPayload(
  payload: UpdateVersionInfo | Error | undefined,
): string | null {
  if (!payload || payload instanceof Error) return null;
  return typeof payload.version === "string" && payload.version
    ? payload.version
    : null;
}

function errorFromPayload(
  payload: UpdateVersionInfo | Error | undefined,
): Error {
  return payload instanceof Error
    ? payload
    : new Error("Unknown application update error");
}

export function createUpdateController(
  options: CreateUpdateControllerOptions,
): UpdateController {
  const { updater, isPackaged, currentVersion, showMessage, requestRestart } =
    options;
  const log = options.log ?? console;

  let activeCheck: Promise<void> | null = null;
  let activeCheckIsManual = false;
  let dismissedAvailableVersion: string | null = null;
  let downloadedVersion: string | null = null;
  let prompt: Promise<void> | null = null;

  updater.autoDownload = false;
  // A downloaded update must never bypass Aria's mutation/session shutdown.
  updater.autoInstallOnAppQuit = false;

  async function showAvailable(version: string, manual: boolean): Promise<void> {
    if (!manual && dismissedAvailableVersion === version) return;
    if (prompt) return prompt;

    prompt = (async () => {
      const { response } = await showMessage({
        type: "info",
        title: "Update available",
        message: `Aria ${version} is available.`,
        detail: "Download it now and keep working while Aria prepares the update.",
        buttons: ["Download update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response !== 0) {
        dismissedAvailableVersion = version;
        return;
      }

      try {
        await updater.downloadUpdate();
      } catch (error) {
        log.error("Application update download failed", error);
        await showMessage({
          type: "error",
          title: "Unable to download update",
          message: "Aria could not download the update.",
          detail: "Check your connection and try again from Check for Updates.",
          buttons: ["Close"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      }
    })().finally(() => {
      prompt = null;
    });
    return prompt;
  }

  async function showReady(version: string): Promise<void> {
    if (prompt) return prompt;
    prompt = (async () => {
      const { response } = await showMessage({
        type: "info",
        title: "Update ready",
        message: `Aria ${version} is ready to install.`,
        detail:
          "Aria will finish in-progress project changes before it restarts.",
        buttons: ["Restart and update", "Later"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      if (response === 0) requestRestart();
    })().finally(() => {
      prompt = null;
    });
    return prompt;
  }

  updater.on("update-available", (payload) => {
    const version = versionFromPayload(payload);
    if (version) void showAvailable(version, activeCheckIsManual);
  });

  updater.on("update-not-available", () => {
    if (!activeCheckIsManual) return;
    void showMessage({
      type: "info",
      title: "Aria is up to date",
      message: `You have the latest version of Aria (${currentVersion}).`,
      buttons: ["Close"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });
  });

  updater.on("update-downloaded", (payload) => {
    const version = versionFromPayload(payload);
    if (!version) return;
    downloadedVersion = version;
    void showReady(version);
  });

  updater.on("error", (payload) => {
    log.error("Application update check failed", errorFromPayload(payload));
  });

  async function checkForUpdates(manual = false): Promise<void> {
    if (!isPackaged) {
      if (manual) {
        await showMessage({
          type: "info",
          title: "Updates unavailable in development",
          message: "Check for Updates works in an installed copy of Aria.",
          buttons: ["Close"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
      }
      return;
    }

    if (manual && downloadedVersion) {
      await showReady(downloadedVersion);
      return;
    }

    if (activeCheck) return activeCheck;
    activeCheckIsManual = manual;
    activeCheck = updater
      .checkForUpdates()
      .then(() => undefined)
      .catch(async (error: unknown) => {
        if (!manual) return;
        await showMessage({
          type: "error",
          title: "Unable to check for updates",
          message: "Aria could not check for updates.",
          detail: "Check your connection and try again.",
          buttons: ["Close"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        log.info("Manual application update check did not complete", error);
      })
      .finally(() => {
        activeCheck = null;
        activeCheckIsManual = false;
      });
    return activeCheck;
  }

  function installDownloadedUpdate(): boolean {
    if (!downloadedVersion) return false;
    updater.quitAndInstall(false, true);
    return true;
  }

  return { checkForUpdates, installDownloadedUpdate };
}
