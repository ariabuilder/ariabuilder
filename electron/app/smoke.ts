import {
  app,
  type BrowserWindow as BrowserWindowType,
} from "../electron-api";
import fs from "node:fs";
import path from "node:path";
import { addRecent, stopProjectCreationJobs } from "../project";
import { trustProject } from "../projectTrust";
import {
  openSession,
  startSessionRuntime,
  stopAllSessions,
} from "../sessions";

type RendererSmokeOptions = {
  userDataPath: string;
};

export interface RendererSmokeController {
  shouldRun(): boolean;
  afterWindowLoad(win: BrowserWindowType, bootProject?: string): Promise<void>;
  fail(error: unknown): void;
}

async function withSmokeTimeout<T>(
  promise: Promise<T>,
  label: string,
  timeoutMs = 5_000,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForSmokeIpc(
  webContents: BrowserWindowType["webContents"],
): Promise<{ version: unknown; sessionList: unknown }> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const version = await withSmokeTimeout(
        webContents.executeJavaScript("window.aria.getVersion()"),
        "renderer version IPC",
      );
      const sessionList = await withSmokeTimeout(
        webContents.executeJavaScript("window.aria.sessions.list()"),
        "renderer session IPC",
      );
      if (typeof version === "string" && Array.isArray(sessionList)) {
        return { version, sessionList };
      }
      lastError = new Error("Renderer IPC returned an invalid shape");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Renderer IPC did not become ready");
}

export function createRendererSmokeController(
  options: RendererSmokeOptions,
): RendererSmokeController {
  const isSmokeOpen = Boolean(process.env.ARIA_SMOKE_OPEN?.trim());
  const isSmokeRenderer = process.env.ARIA_SMOKE_RENDERER === "1";
  const shouldRun = (): boolean => isSmokeOpen || isSmokeRenderer;

  const finish = async (): Promise<void> => {
    await Promise.all([stopAllSessions(), stopProjectCreationJobs()]);
    app.exit(typeof process.exitCode === "number" ? process.exitCode : 0);
  };

  const fail = (error: unknown): void => {
    console.error("ARIA_SMOKE_OPEN_FAIL", error);
    process.exitCode = 1;
    void finish();
  };

  const afterWindowLoad = async (
    win: BrowserWindowType,
    bootProject?: string,
  ): Promise<void> => {
    if (!shouldRun() || win.isDestroyed()) return;
    let translationDiscovery = false;
    let terminalStarted = false;
    try {
      if (isSmokeOpen && bootProject) {
        trustProject(options.userDataPath, bootProject, "smoke");
        const projectSession = await openSession(bootProject, win.webContents.id);
        addRecent(options.userDataPath, projectSession.path);
        const runtimeSession = await startSessionRuntime(projectSession.path);
        if (
          !runtimeSession.live ||
          !runtimeSession.previewUrl ||
          runtimeSession.authoringState !== "ready" ||
          runtimeSession.markersPresent !== true
        ) {
          throw new Error(
            runtimeSession.error ?? "Packaged Astro runtime did not become Composer-ready",
          );
        }
        const externalPid = Number(process.env.ARIA_SMOKE_EXTERNAL_PID ?? 0);
        if (externalPid > 0) {
          try {
            process.kill(externalPid, 0);
          } catch {
            throw new Error("Aria stopped the external Astro preview during packaged smoke");
          }
          if (runtimeSession.previewOwnership !== "aria") {
            throw new Error("Aria did not start its own instrumented preview beside the external server");
          }
        }
        const response = await fetch(`${runtimeSession.previewUrl}/`);
        if (
          !response.ok ||
          !(await response.text()).includes("Aria packaged runtime smoke")
        ) {
          throw new Error("Packaged Astro smoke route did not render the fixture");
        }
        const designResponse = await fetch(`${runtimeSession.previewUrl}/?aria-design=1`);
        const designHtml = await designResponse.text();
        if (!designResponse.ok || !designHtml.includes("data-aria-s")) {
          throw new Error("Packaged Composer preview did not include selection markers");
        }

        const relativeFile = "src/pages/index.astro";
        const absoluteFile = path.join(bootProject, "src", "pages", "index.astro");
        const originalSource = fs.readFileSync(absoluteFile, "utf8");
        const draftSource = originalSource.replace(
          "Aria packaged runtime smoke",
          "Aria Composer draft smoke",
        );
        const leaseId = `packaged-smoke-${Date.now()}`;
        try {
          const draftResult = await withSmokeTimeout(
            win.webContents.executeJavaScript(
              `window.aria.composer.setPreviewDraft(${JSON.stringify(bootProject)}, ${JSON.stringify(relativeFile)}, ${JSON.stringify(draftSource)}, ${JSON.stringify(leaseId)}, 1)`,
            ),
            "Composer draft IPC",
          );
          if (!draftResult || draftResult.ok !== true || draftResult.revision !== 1) {
            throw new Error("Composer draft IPC returned an invalid acknowledgement");
          }
          let draftRendered = false;
          for (let attempt = 0; attempt < 40; attempt += 1) {
            const draftResponse = await fetch(
              `${runtimeSession.previewUrl}/?aria-design=1&smoke=${Date.now()}`,
            );
            if (draftResponse.ok && (await draftResponse.text()).includes("Aria Composer draft smoke")) {
              draftRendered = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 250));
          }
          if (!draftRendered) {
            throw new Error("Composer preview did not render the acknowledged draft");
          }
        } finally {
          await win.webContents.executeJavaScript(
            `window.aria.composer.clearPreviewDraft(${JSON.stringify(bootProject)}, ${JSON.stringify(leaseId)})`,
          ).catch(() => undefined);
        }

        const translationResult = await withSmokeTimeout(
          win.webContents.executeJavaScript(
            `window.aria.composer.listTranslationCatalogs(${JSON.stringify(bootProject)}, true)`,
          ),
          "translation discovery IPC",
          20_000,
        );
        translationDiscovery = Boolean(
          translationResult &&
          Array.isArray(translationResult.catalogs) &&
          Array.isArray(translationResult.unsupported) &&
          typeof translationResult.scannedAt === "string",
        );
        if (!translationDiscovery) {
          throw new Error("Translation discovery IPC returned an invalid result");
        }

        terminalStarted = await withSmokeTimeout(
          win.webContents.executeJavaScript(`
            (async () => {
              const marker = "ARIA_TERMINAL_SMOKE_${Date.now()}";
              const terminal = await window.aria.terminal.create(${JSON.stringify(bootProject)}, 80, 24);
              let unsubscribe = () => undefined;
              try {
                await new Promise((resolve, reject) => {
                  let settled = false;
                  const finish = (error) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    if (error) reject(error);
                    else resolve(undefined);
                  };
                  const timer = setTimeout(() => finish(new Error("Terminal did not echo its smoke marker")), 10_000);
                  unsubscribe = window.aria.terminal.onData((payload) => {
                    if (payload.id === terminal.id && payload.data.includes(marker)) finish();
                  });
                  window.aria.terminal.write(terminal.id, "echo " + marker + "\\r").catch(finish);
                });
                return true;
              } finally {
                unsubscribe();
                await window.aria.terminal.dispose(terminal.id).catch(() => undefined);
              }
            })()
          `),
          "terminal startup IPC",
          15_000,
        );
      }

      const { version, sessionList } = await waitForSmokeIpc(win.webContents);
      const report = await withSmokeTimeout(
        win.webContents.executeJavaScript(`
          (() => {
            const root = document.getElementById("root");
            const text = (root?.innerText || "").trim().slice(0, 800);
            const htmlLen = root?.innerHTML?.length ?? 0;
            const errEl = document.querySelector("[data-aria-error]");
            return {
              htmlLen,
              text,
              errorText: errEl ? errEl.textContent : null,
              ariaWorkspace: Boolean(window.aria && window.aria.workspace && window.aria.sessions),
            };
          })()
        `),
        "renderer DOM inspection",
      );
      report.version = version;
      report.sessionCount = Array.isArray(sessionList) ? sessionList.length : null;
      report.runtimeLive =
        Array.isArray(sessionList) &&
        sessionList.some(
          (item) =>
            item &&
            typeof item === "object" &&
            "live" in item &&
            item.live === true,
        );
      report.authoringReady =
        Array.isArray(sessionList) &&
        sessionList.some(
          (item) =>
            item &&
            typeof item === "object" &&
            "authoringState" in item &&
            item.authoringState === "ready",
        );
      report.ipcOk = typeof version === "string" && report.sessionCount !== null;
      report.translationDiscovery = translationDiscovery;
      report.terminalStarted = terminalStarted;
      report.ipcError = null;
      const valid =
        report.htmlLen > 0 &&
        report.ariaWorkspace &&
        report.ipcOk &&
        !report.ipcError &&
        !report.errorText &&
        (!isSmokeOpen || (
          report.sessionCount === 1 &&
          report.runtimeLive &&
          report.authoringReady &&
          report.translationDiscovery &&
          report.terminalStarted
        ));
      if (valid) {
        console.log(
          isSmokeOpen ? "ARIA_SMOKE_OPEN_OK" : "ARIA_SMOKE_RENDERER_OK",
          JSON.stringify(report),
        );
      } else {
        console.error("ARIA_SMOKE_OPEN_FAIL", JSON.stringify(report));
        process.exitCode = 1;
      }
    } catch (error) {
      console.error("ARIA_SMOKE_OPEN_FAIL", error);
      process.exitCode = 1;
    }
    await finish();
  };

  return { shouldRun, afterWindowLoad, fail };
}
