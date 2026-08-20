import { describe, expect, it, vi } from "vitest";
import {
  createUpdateController,
  type UpdateClient,
  type UpdateClientEvent,
  type UpdateVersionInfo,
} from "./updaterController";

function createFakeUpdater() {
  const listeners = new Map<
    UpdateClientEvent,
    Array<(payload?: UpdateVersionInfo | Error) => void>
  >();
  const checkForUpdates = vi.fn(async () => undefined);
  const downloadUpdate = vi.fn(async () => undefined);
  const quitAndInstall = vi.fn();
  const updater: UpdateClient = {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    on(event, listener) {
      const eventListeners = listeners.get(event) ?? [];
      eventListeners.push(listener);
      listeners.set(event, eventListeners);
      return updater;
    },
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
  };
  return {
    updater,
    checkForUpdates,
    downloadUpdate,
    quitAndInstall,
    emit(event: UpdateClientEvent, payload?: UpdateVersionInfo | Error) {
      for (const listener of listeners.get(event) ?? []) listener(payload);
    },
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("application updater controller", () => {
  it("never downloads or installs an update without a user choice", async () => {
    const fake = createFakeUpdater();
    const showMessage = vi.fn(async () => ({ response: 1 }));
    const requestRestart = vi.fn();
    const controller = createUpdateController({
      updater: fake.updater,
      isPackaged: true,
      currentVersion: "0.1.0",
      showMessage,
      requestRestart,
    });

    expect(fake.updater.autoDownload).toBe(false);
    expect(fake.updater.autoInstallOnAppQuit).toBe(false);

    const check = controller.checkForUpdates();
    fake.emit("update-available", { version: "0.2.0" });
    await check;
    await flushPromises();

    expect(showMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Aria 0.2.0 is available.",
        buttons: ["Download update", "Later"],
      }),
    );
    expect(fake.downloadUpdate).not.toHaveBeenCalled();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("downloads after confirmation and requests a coordinated restart", async () => {
    const fake = createFakeUpdater();
    const showMessage = vi
      .fn()
      .mockResolvedValueOnce({ response: 0 })
      .mockResolvedValueOnce({ response: 0 });
    const requestRestart = vi.fn();
    const controller = createUpdateController({
      updater: fake.updater,
      isPackaged: true,
      currentVersion: "0.1.0",
      showMessage,
      requestRestart,
    });

    const check = controller.checkForUpdates(true);
    fake.emit("update-available", { version: "0.2.0" });
    await check;
    await flushPromises();
    expect(fake.downloadUpdate).toHaveBeenCalledOnce();

    fake.emit("update-downloaded", { version: "0.2.0" });
    await flushPromises();
    expect(requestRestart).toHaveBeenCalledOnce();
    expect(fake.quitAndInstall).not.toHaveBeenCalled();

    expect(controller.installDownloadedUpdate()).toBe(true);
    expect(fake.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it("keeps expected private-feed errors quiet unless the check was manual", async () => {
    const fake = createFakeUpdater();
    const privateFeedError = new Error("404 Not Found");
    fake.checkForUpdates.mockRejectedValue(privateFeedError);
    const showMessage = vi.fn(async () => ({ response: 0 }));
    const log = { error: vi.fn(), info: vi.fn() };
    const controller = createUpdateController({
      updater: fake.updater,
      isPackaged: true,
      currentVersion: "0.1.0",
      showMessage,
      requestRestart: vi.fn(),
      log,
    });

    await controller.checkForUpdates();
    expect(showMessage).not.toHaveBeenCalled();

    await controller.checkForUpdates(true);
    expect(showMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Unable to check for updates",
        detail: "Check your connection and try again.",
      }),
    );
  });

  it("explains that development builds cannot update", async () => {
    const fake = createFakeUpdater();
    const showMessage = vi.fn(async () => ({ response: 0 }));
    const controller = createUpdateController({
      updater: fake.updater,
      isPackaged: false,
      currentVersion: "0.1.0",
      showMessage,
      requestRestart: vi.fn(),
    });

    await controller.checkForUpdates(true);

    expect(fake.checkForUpdates).not.toHaveBeenCalled();
    expect(showMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Updates unavailable in development",
      }),
    );
  });
});
