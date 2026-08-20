import type { UpdateController } from "../updaterController";
import {
  beginCmsMutationShutdown,
  drainCmsTransactions,
} from "../cms/mutationCoordinator";
import { app } from "../electron-api";
import { disposeAllAgentState } from "../agent";
import { beginMutationShutdown, drainProjectMutations } from "../mutations";
import { stopProjectCreationJobs } from "../project";
import { stopAllSessions } from "../sessions";
import { cancelWarmPageThumbs } from "../thumbs";
import { disposeAllTerminals } from "../terminal";

type ShutdownControllerOptions = {
  hasSingleInstanceLock: boolean;
  broadcast(channel: string, ...args: unknown[]): void;
  getUpdater(): UpdateController | null;
};

export interface ShutdownController {
  isQuitting(): boolean;
  requestRestartForUpdate(): void;
  handleBeforeQuit(event: { preventDefault(): void }): void;
}

export function createShutdownController(
  options: ShutdownControllerOptions,
): ShutdownController {
  let quitting = false;
  let cleanupComplete = false;
  let cleanupPromise: Promise<void> | null = null;
  let restartForUpdateRequested = false;

  const handleBeforeQuit = (event: { preventDefault(): void }): void => {
    if (!options.hasSingleInstanceLock || cleanupComplete) return;
    event.preventDefault();
    if (cleanupPromise) return;
    quitting = true;
    beginMutationShutdown();
    beginCmsMutationShutdown();
    options.broadcast("app:shutdown-waiting", {
      message: "Waiting for project changes to finish before quitting.",
    });
    cleanupPromise = Promise.all([
      disposeAllAgentState(),
      import("../cms/wordpressImport").then((mod) =>
        mod.cancelAllWordPressImports(),
      ),
      stopProjectCreationJobs(),
    ])
      .then(() => Promise.all([drainProjectMutations(), drainCmsTransactions()]))
      .then(() => stopAllSessions())
      .then(() => {
        disposeAllTerminals();
        cancelWarmPageThumbs();
      })
      .catch((error: unknown) => {
        disposeAllTerminals();
        cancelWarmPageThumbs();
        console.error("Shutdown cleanup failed:", error);
      });
    void cleanupPromise.finally(() => {
      cleanupComplete = true;
      if (restartForUpdateRequested) {
        try {
          if (options.getUpdater()?.installDownloadedUpdate()) return;
        } catch (error) {
          console.error("Unable to launch the application update installer:", error);
        }
      }
      app.quit();
    });
  };

  return {
    isQuitting: () => quitting,
    requestRestartForUpdate: () => {
      restartForUpdateRequested = true;
      app.quit();
    },
    handleBeforeQuit,
  };
}
