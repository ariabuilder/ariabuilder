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
    let thumbnailCaptureOk = false;
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

        await win.webContents.executeJavaScript(`(() => {
          const overlay = document.createElement("div");
          overlay.id = "aria-smoke-thumbnail-overlay";
          overlay.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#ff00ff";
          document.body.appendChild(overlay);
        })()`);
        let captureResult;
        try {
          captureResult = await withSmokeTimeout(
            win.webContents.executeJavaScript(
              `window.aria.thumbs.capture({
                projectPath: ${JSON.stringify(bootProject)},
                baseUrl: ${JSON.stringify(runtimeSession.previewUrl)},
                route: "/",
                viewport: { width: 768, height: 1024 },
                captureHeight: 576,
                mtimeMs: null,
              })`,
            ),
            "clean page thumbnail capture",
          );
        } finally {
          await win.webContents.executeJavaScript(
            `document.getElementById("aria-smoke-thumbnail-overlay")?.remove()`,
          ).catch(() => undefined);
        }
        if (!captureResult || captureResult.ok !== true) {
          throw new Error(
            captureResult?.error ?? "Clean page thumbnail capture failed",
          );
        }
        const cachedThumbs = await withSmokeTimeout(
          win.webContents.executeJavaScript(
            `Promise.all([
              window.aria.thumbs.getPage({
                projectPath: ${JSON.stringify(bootProject)},
                route: "/",
                mtimeMs: null,
              }),
              window.aria.thumbs.getProject(${JSON.stringify(bootProject)}),
            ])`,
          ),
          "clean page thumbnail cache lookup",
        );
        thumbnailCaptureOk =
          Array.isArray(cachedThumbs) &&
          cachedThumbs.length === 2 &&
          cachedThumbs.every(
            (thumb) =>
              thumb &&
              typeof thumb.dataUrl === "string" &&
              thumb.dataUrl.startsWith("data:image/png;base64,"),
          );
        if (!thumbnailCaptureOk) {
          throw new Error(
            "Clean page thumbnail was not cached for page and project",
          );
        }
        const pageThumbDataUrl = (
          cachedThumbs as Array<{ dataUrl?: unknown }>
        )[0]?.dataUrl;
        const magentaPixelRatio = await withSmokeTimeout(
          win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => {
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth;
              canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d", { willReadFrequently: true });
              if (!context) {
                reject(new Error("Thumbnail canvas context unavailable"));
                return;
              }
              context.drawImage(image, 0, 0);
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
              let magenta = 0;
              for (let index = 0; index < pixels.length; index += 16) {
                if (pixels[index] > 240 && pixels[index + 1] < 20 && pixels[index + 2] > 240) {
                  magenta += 1;
                }
              }
              resolve(magenta / Math.ceil(pixels.length / 16));
            };
            image.onerror = () => reject(new Error("Thumbnail PNG could not be decoded"));
            image.src = ${JSON.stringify(pageThumbDataUrl)};
          })`),
          "clean page thumbnail pixel inspection",
        );
        if (
          typeof magentaPixelRatio !== "number" ||
          magentaPixelRatio > 0.01
        ) {
          throw new Error("Composer overlay leaked into the page thumbnail");
        }
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
      report.thumbnailCaptureOk = thumbnailCaptureOk;
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
          report.terminalStarted &&
          report.thumbnailCaptureOk
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
