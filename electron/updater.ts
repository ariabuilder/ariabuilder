import electronUpdater from "electron-updater";
import type { MessageBoxOptions } from "electron";
import { app, BrowserWindow, dialog } from "./electron-api";
import {
  createUpdateController,
  type UpdateController,
  type UpdateDialogOptions,
} from "./updaterController";

const FIRST_AUTOMATIC_CHECK_MS = 15_000;
const AUTOMATIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1_000;

function showUpdateMessage(options: UpdateDialogOptions) {
  const messageOptions: MessageBoxOptions = options;
  const parent =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  return parent
    ? dialog.showMessageBox(parent, messageOptions)
    : dialog.showMessageBox(messageOptions);
}

export function createApplicationUpdater(options: {
  requestRestart: () => void;
}): UpdateController {
  // electron-updater is CommonJS. Access through the default export so the
  // external runtime dependency remains compatible with Aria's ESM main bundle.
  const { autoUpdater } = electronUpdater;
  const controller = createUpdateController({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    currentVersion: app.getVersion(),
    showMessage: showUpdateMessage,
    requestRestart: options.requestRestart,
  });

  if (app.isPackaged) {
    const firstCheck = setTimeout(() => {
      void controller.checkForUpdates();
    }, FIRST_AUTOMATIC_CHECK_MS);
    firstCheck.unref();

    const interval = setInterval(() => {
      void controller.checkForUpdates();
    }, AUTOMATIC_CHECK_INTERVAL_MS);
    interval.unref();
  }

  return controller;
}
