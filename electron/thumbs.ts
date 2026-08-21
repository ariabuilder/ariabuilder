import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, type BrowserWindow as BrowserWindowType } from "./electron-api";
import { isNavigablePageRoute } from "../shared/pages";
import {
  COMPONENT_THUMB_VERSION,
  ensureComponentPreviewHarness,
  isAriaManagedRoute,
} from "./componentPreviewHarness";
import {
  LAYOUT_PREVIEW_ROUTE,
  LAYOUT_THUMB_VERSION,
  ensureLayoutPreviewHarness,
  isSafeLayoutId,
} from "./layoutPreviewHarness";
import {
  buildComponentPreviewUrl,
  COMPONENT_PREVIEW_PAINT_SCRIPT,
  componentPreviewReadyScript,
} from "./thumbs/componentPreviewUrl";
import { prioritizeWarmQueue } from "./thumbs/warmQueue";

export type CaptureViewport = {
  width: number;
  height: number;
};

export type ThumbCaptureResult =
  | { ok: true }
  | { ok: false; error?: string };

export type ThumbGetResult = { dataUrl: string } | null;

export type PageThumbReadyPayload = {
  projectPath: string;
  route: string;
};

export type ComponentThumbReadyPayload = {
  projectPath: string;
  id: string;
  dataUrl?: string;
  mtimeMs?: number | null;
};

export type LayoutThumbReadyPayload = {
  projectPath: string;
  id: string;
};

export type WarmPagesResult = {
  captured: number;
  skipped: number;
  cancelled: boolean;
};

export type WarmComponentsResult = WarmPagesResult;
export type WarmLayoutsResult = WarmPagesResult;

type PageThumbMeta = {
  route: string;
  mtimeMs: number | null;
  capturedAt: number;
  /** Capture semantics version. Older captures are regenerated in place. */
  version: number;
};

type ComponentThumbMeta = {
  id: string;
  mtimeMs: number | null;
  capturedAt: number;
  /** Harness/capture semantics version — stale when mismatched. */
  version: number;
};

type WarmPage = {
  route: string;
  mtimeMs?: number | null;
};

type WarmComponent = {
  id: string;
  mtimeMs?: number | null;
};

type WarmLayout = {
  id: string;
  mtimeMs?: number | null;
};

const WARM_VIEWPORT = { width: 1280, height: 800 } as const;
const WARM_SETTLE_MS = 1_800;
const WARM_LOAD_TIMEOUT_MS = 20_000;
const PAGE_CAPTURE_ASSET_TIMEOUT_MS = 2_500;
const COMPONENT_READY_POLL_MS = 50;
const COMPONENT_STALE_RELOAD_MS = 800;
const COMPONENT_STALE_RELOAD_MAX = 4;
/** Extra settle after writing a new harness so Astro/Vite picks it up. */
const HARNESS_HMR_SETTLE_MS = 2_000;

/** Clean page capture introduced after Stage chrome leaked into cached thumbs. */
export const PAGE_THUMB_VERSION = 2;

let pageThumbReadyHandler:
  | ((payload: PageThumbReadyPayload) => void)
  | null = null;

let componentThumbReadyHandler:
  | ((payload: ComponentThumbReadyPayload) => void)
  | null = null;

let layoutThumbReadyHandler:
  | ((payload: LayoutThumbReadyPayload) => void)
  | null = null;

/** Main process registers this to push `thumbs:pageReady` to the renderer. */
export function setPageThumbReadyHandler(
  handler: ((payload: PageThumbReadyPayload) => void) | null,
): void {
  pageThumbReadyHandler = handler;
}

/** Main process registers this to push `thumbs:componentReady` to the renderer. */
export function setComponentThumbReadyHandler(
  handler: ((payload: ComponentThumbReadyPayload) => void) | null,
): void {
  componentThumbReadyHandler = handler;
}

export function setLayoutThumbReadyHandler(
  handler: ((payload: LayoutThumbReadyPayload) => void) | null,
): void {
  layoutThumbReadyHandler = handler;
}

function notifyPageThumbReady(projectPath: string, route: string): void {
  try {
    pageThumbReadyHandler?.({ projectPath, route });
  } catch {
    /* non-fatal */
  }
}

function notifyComponentThumbReady(
  projectPath: string,
  id: string,
  dataUrl?: string,
  mtimeMs?: number | null,
): void {
  try {
    componentThumbReadyHandler?.({ projectPath, id, dataUrl, mtimeMs });
  } catch {
    /* non-fatal */
  }
}

function notifyLayoutThumbReady(projectPath: string, id: string): void {
  try {
    layoutThumbReadyHandler?.({ projectPath, id });
  } catch {
    /* non-fatal */
  }
}

function isWarmableRoute(route: string): boolean {
  // Skip Astro dynamic segments — they 404 without params.
  if (!isNavigablePageRoute(route)) return false;
  // Skip Aria-managed harness pages (not user content).
  if (isAriaManagedRoute(route)) return false;
  return true;
}

function isSafeComponentId(id: string): boolean {
  const normalized = id.trim().replace(/\\/g, "/");
  if (!normalized.startsWith("src/components/")) return false;
  if (normalized.includes("..") || normalized.includes("\0")) return false;
  return true;
}

function isAllowedPreviewBase(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function pagePreviewUrl(baseUrl: string, route: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return null;
    }
    const pathname = route.trim() || "/";
    url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function layoutPreviewUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return null;
    }
    url.pathname = LAYOUT_PREVIEW_ROUTE;
    url.search = "";
    url.hash = "";
    url.searchParams.set("t", String(Date.now()));
    return url.toString();
  } catch {
    return null;
  }
}

function projectHash(projectPath: string): string {
  return crypto.createHash("sha1").update(projectPath).digest("hex").slice(0, 16);
}

function routeHash(route: string): string {
  const normalized = route.trim() || "/";
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function componentIdHash(id: string): string {
  const normalized = id.trim().replace(/\\/g, "/");
  return crypto.createHash("sha1").update(normalized).digest("hex").slice(0, 16);
}

function thumbsRoot(userData: string): string {
  return path.join(userData, "thumbs");
}

function projectThumbPaths(userData: string, projectPath: string) {
  const hash = projectHash(projectPath);
  const base = path.join(thumbsRoot(userData), "projects", hash);
  return { png: `${base}.png`, meta: `${base}.json` };
}

function pageThumbPaths(userData: string, projectPath: string, route: string) {
  const dir = path.join(thumbsRoot(userData), "pages", projectHash(projectPath));
  const key = routeHash(route);
  return {
    dir,
    png: path.join(dir, `${key}.png`),
    meta: path.join(dir, `${key}.json`),
  };
}

function componentThumbPaths(
  userData: string,
  projectPath: string,
  id: string,
) {
  const dir = path.join(
    thumbsRoot(userData),
    "components",
    projectHash(projectPath),
  );
  const key = componentIdHash(id);
  return {
    dir,
    png: path.join(dir, `${key}.png`),
    meta: path.join(dir, `${key}.json`),
  };
}

function layoutThumbPaths(userData: string, projectPath: string, id: string) {
  const dir = path.join(
    thumbsRoot(userData),
    "layouts",
    projectHash(projectPath),
  );
  const key = componentIdHash(id);
  return {
    dir,
    png: path.join(dir, `${key}.png`),
    meta: path.join(dir, `${key}.json`),
  };
}

function readDataUrl(pngPath: string): string | null {
  try {
    if (!fs.existsSync(pngPath)) return null;
    const buf = fs.readFileSync(pngPath);
    if (!buf.length) return null;
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function readPageMeta(metaPath: string): PageThumbMeta | null {
  try {
    if (!fs.existsSync(metaPath)) return null;
    const raw = JSON.parse(
      fs.readFileSync(metaPath, "utf8"),
    ) as Partial<PageThumbMeta>;
    if (!raw || typeof raw.route !== "string") return null;
    return {
      route: raw.route,
      mtimeMs:
        typeof raw.mtimeMs === "number" && Number.isFinite(raw.mtimeMs)
          ? raw.mtimeMs
          : null,
      capturedAt:
        typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt)
          ? raw.capturedAt
          : 0,
      version:
        typeof raw.version === "number" && Number.isFinite(raw.version)
          ? raw.version
          : 0,
    };
  } catch {
    return null;
  }
}

function readComponentMeta(metaPath: string): ComponentThumbMeta | null {
  try {
    if (!fs.existsSync(metaPath)) return null;
    const raw = JSON.parse(
      fs.readFileSync(metaPath, "utf8"),
    ) as Partial<ComponentThumbMeta>;
    if (!raw || typeof raw.id !== "string") return null;
    return {
      id: raw.id,
      mtimeMs:
        typeof raw.mtimeMs === "number" && Number.isFinite(raw.mtimeMs)
          ? raw.mtimeMs
          : null,
      capturedAt:
        typeof raw.capturedAt === "number" && Number.isFinite(raw.capturedAt)
          ? raw.capturedAt
          : 0,
      version:
        typeof raw.version === "number" && Number.isFinite(raw.version)
          ? raw.version
          : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Reject empty / connection-error frames (near-uniform paint) so a dying
 * preview cannot overwrite the last good thumb with a white screen.
 */
function isBlankCapture(image: {
  isEmpty: () => boolean;
  resize: (opts: { width: number; height: number }) => {
    toBitmap: () => Buffer;
  };
}): boolean {
  if (image.isEmpty()) return true;
  try {
    const sample = image.resize({ width: 48, height: 30 });
    const bitmap = sample.toBitmap();
    const pixels = Math.floor(bitmap.length / 4);
    if (pixels < 1) return true;

    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      sumB += bitmap[i]!;
      sumG += bitmap[i + 1]!;
      sumR += bitmap[i + 2]!;
    }
    const meanR = sumR / pixels;
    const meanG = sumG / pixels;
    const meanB = sumB / pixels;

    let variance = 0;
    for (let i = 0; i < bitmap.length; i += 4) {
      const db = bitmap[i]! - meanB;
      const dg = bitmap[i + 1]! - meanG;
      const dr = bitmap[i + 2]! - meanR;
      variance += dr * dr + dg * dg + db * db;
    }
    variance /= pixels;
    // Real pages have text/imagery contrast; blank/error frames are flat.
    return variance < 80;
  } catch {
    return false;
  }
}

function writePageThumbPng(
  userData: string,
  projectPath: string,
  route: string,
  png: Buffer,
  mtimeMs?: number | null,
): void {
  const pagePaths = pageThumbPaths(userData, projectPath, route);
  fs.mkdirSync(pagePaths.dir, { recursive: true });
  fs.writeFileSync(pagePaths.png, png);
  const meta: PageThumbMeta = {
    route,
    mtimeMs:
      typeof mtimeMs === "number" && Number.isFinite(mtimeMs) ? mtimeMs : null,
    capturedAt: Date.now(),
    version: PAGE_THUMB_VERSION,
  };
  fs.writeFileSync(pagePaths.meta, JSON.stringify(meta));
  notifyPageThumbReady(projectPath, route);
}

function writeComponentThumbPng(
  userData: string,
  projectPath: string,
  id: string,
  png: Buffer,
  mtimeMs?: number | null,
): string {
  const paths = componentThumbPaths(userData, projectPath, id);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.png, png);
  const meta: ComponentThumbMeta = {
    id,
    mtimeMs:
      typeof mtimeMs === "number" && Number.isFinite(mtimeMs) ? mtimeMs : null,
    capturedAt: Date.now(),
    version: COMPONENT_THUMB_VERSION,
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta));
  const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
  notifyComponentThumbReady(projectPath, id, dataUrl, meta.mtimeMs);
  return dataUrl;
}

function writeLayoutThumbPng(
  userData: string,
  projectPath: string,
  id: string,
  png: Buffer,
  mtimeMs?: number | null,
): void {
  const paths = layoutThumbPaths(userData, projectPath, id);
  fs.mkdirSync(paths.dir, { recursive: true });
  fs.writeFileSync(paths.png, png);
  const meta: ComponentThumbMeta = {
    id,
    mtimeMs:
      typeof mtimeMs === "number" && Number.isFinite(mtimeMs) ? mtimeMs : null,
    capturedAt: Date.now(),
    version: LAYOUT_THUMB_VERSION,
  };
  fs.writeFileSync(paths.meta, JSON.stringify(meta));
  notifyLayoutThumbReady(projectPath, id);
}

/**
 * Whether warm/capture can skip this route. Existing thumbs stay visible via
 * getPageThumb even when stale — freshness only gates regeneration.
 */
function pageThumbIsFresh(
  userData: string,
  projectPath: string,
  route: string,
  mtimeMs?: number | null,
): boolean {
  const paths = pageThumbPaths(
    userData,
    projectPath.trim(),
    route.trim() || "/",
  );
  if (!fs.existsSync(paths.png)) return false;
  const meta = readPageMeta(paths.meta);
  if (!meta || meta.version !== PAGE_THUMB_VERSION) return false;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return true;
  return meta.mtimeMs === mtimeMs;
}

function componentThumbIsFresh(
  userData: string,
  projectPath: string,
  id: string,
  mtimeMs?: number | null,
): boolean {
  const paths = componentThumbPaths(userData, projectPath.trim(), id.trim());
  if (!fs.existsSync(paths.png)) return false;
  const meta = readComponentMeta(paths.meta);
  if (!meta || meta.version !== COMPONENT_THUMB_VERSION) return false;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return true;
  return meta.mtimeMs === mtimeMs;
}

function layoutThumbIsFresh(
  userData: string,
  projectPath: string,
  id: string,
  mtimeMs?: number | null,
): boolean {
  const paths = layoutThumbPaths(userData, projectPath.trim(), id.trim());
  if (!fs.existsSync(paths.png)) return false;
  const meta = readComponentMeta(paths.meta);
  if (!meta || meta.version !== LAYOUT_THUMB_VERSION) return false;
  if (typeof mtimeMs !== "number" || !Number.isFinite(mtimeMs)) return true;
  return meta.mtimeMs === mtimeMs;
}

type ActiveCaptureJob = {
  generation: number;
  cancelled: boolean;
  window: BrowserWindowType | null;
};

type PageCaptureReadyResult = {
  ok?: boolean;
  error?: string;
};

const activeCaptureJobs = new Map<string, ActiveCaptureJob>();
let activeCaptureGeneration = 0;

function destroyCaptureWindow(win: BrowserWindowType | null): void {
  if (!win) return;
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
    /* already gone */
  }
}

function cancelActiveCapture(projectPath: string): void {
  const job = activeCaptureJobs.get(projectPath);
  if (!job) return;
  job.cancelled = true;
  activeCaptureJobs.delete(projectPath);
  destroyCaptureWindow(job.window);
}

/** Stop clean page captures during workspace teardown or app shutdown. */
export function cancelActiveThumbCaptures(): void {
  for (const projectPath of [...activeCaptureJobs.keys()]) {
    cancelActiveCapture(projectPath);
  }
}

function activeCaptureIsCurrent(
  projectPath: string,
  job: ActiveCaptureJob,
): boolean {
  const current = activeCaptureJobs.get(projectPath);
  if (
    job.cancelled ||
    !current ||
    current !== job ||
    current.generation !== job.generation
  ) {
    return false;
  }
  const win = job.window;
  return Boolean(
    win && !win.isDestroyed() && !win.webContents.isDestroyed(),
  );
}

function createCaptureWindow(viewport: CaptureViewport): BrowserWindowType {
  const win = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    useContentSize: true,
    frame: false,
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    focusable: false,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true,
      webSecurity: true,
    },
  });
  win.webContents.setAudioMuted(true);
  win.webContents.setBackgroundThrottling(false);
  return win;
}

function loadUrlForCapture(
  win: BrowserWindowType,
  url: string,
  job: ActiveCaptureJob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (job.cancelled || win.isDestroyed()) {
      reject(new Error("Capture cancelled"));
      return;
    }
    const { webContents } = win;
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Thumbnail capture load timed out"));
    }, WARM_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.removeListener("did-finish-load", onLoad);
      webContents.removeListener("did-fail-load", onFail);
      win.removeListener("closed", onClosed);
    };
    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: unknown,
      _errorCode: number,
      errorDescription: string,
    ) => {
      cleanup();
      reject(new Error(errorDescription || "Failed to load page"));
    };
    const onClosed = () => {
      cleanup();
      reject(new Error("Capture cancelled"));
    };

    webContents.on("did-finish-load", onLoad);
    webContents.on("did-fail-load", onFail);
    win.on("closed", onClosed);
    void win.loadURL(url).catch((error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

export function pageCaptureReadyScript(captureHeight: number): string {
  return `(() => {
    const captureHeight = ${JSON.stringify(captureHeight)};
    const failure = () => {
      if (document.querySelector("vite-error-overlay")) return "Preview error overlay";
      if (document.title === "Error") return "Preview error page";
      return "";
    };
    const initialFailure = failure();
    if (initialFailure) return Promise.resolve({ ok: false, error: initialFailure });
    const images = [...document.images].filter((image) => {
      const rect = image.getBoundingClientRect();
      return rect.bottom > 0 && rect.top < captureHeight && rect.right > 0;
    });
    const waitForImage = (image) => {
      if (image.complete) {
        return typeof image.decode === "function"
          ? image.decode().catch(() => undefined)
          : Promise.resolve();
      }
      return new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      });
    };
    const assets = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      ...images.map(waitForImage),
    ]);
    const timeout = new Promise((resolve) => {
      setTimeout(resolve, ${PAGE_CAPTURE_ASSET_TIMEOUT_MS});
    });
    return Promise.race([assets, timeout])
      .then(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }))
      .then(() => {
        const finalFailure = failure();
        return finalFailure
          ? { ok: false, error: finalFailure }
          : { ok: true };
      });
  })()`;
}

async function waitForPageCaptureReady(
  win: BrowserWindowType,
  captureHeight: number,
): Promise<void> {
  const result = (await win.webContents.executeJavaScript(
    pageCaptureReadyScript(captureHeight),
  )) as PageCaptureReadyResult;
  if (!result?.ok) {
    throw new Error(result?.error || "Page did not become ready for capture");
  }
}

/**
 * Render the selected route in a hidden top-level page. The visible app window
 * is never the capture source, so Composer selection chrome cannot leak in.
 */
export async function captureThumbs(
  userData: string,
  opts: {
    projectPath: string;
    baseUrl: string;
    route: string;
    viewport: CaptureViewport;
    captureHeight: number;
    mtimeMs?: number | null;
  },
): Promise<ThumbCaptureResult> {
  const projectPath = opts.projectPath.trim();
  const route = (opts.route.trim() || "/") as string;
  if (!projectPath) return { ok: false, error: "Project path is required" };
  const url = pagePreviewUrl(opts.baseUrl, route);
  if (!url) return { ok: false, error: "Preview URL is invalid" };

  const viewport = {
    width: Math.max(1, Math.round(opts.viewport.width)),
    height: Math.max(1, Math.round(opts.viewport.height)),
  };
  const captureHeight = Math.min(
    viewport.height,
    Math.max(1, Math.round(opts.captureHeight)),
  );

  cancelActiveCapture(projectPath);
  const win = createCaptureWindow(viewport);
  const job: ActiveCaptureJob = {
    generation: ++activeCaptureGeneration,
    cancelled: false,
    window: win,
  };
  activeCaptureJobs.set(projectPath, job);

  try {
    await loadUrlForCapture(win, url, job);
    if (!activeCaptureIsCurrent(projectPath, job)) {
      throw new Error("Capture superseded");
    }
    const loadedUrl = new URL(win.webContents.getURL());
    if (loadedUrl.origin !== new URL(url).origin) {
      throw new Error("Preview redirected outside the project origin");
    }
    await waitForPageCaptureReady(win, captureHeight);
    if (!activeCaptureIsCurrent(projectPath, job)) {
      throw new Error("Capture superseded");
    }

    const image = await win.webContents.capturePage(
      { x: 0, y: 0, width: viewport.width, height: captureHeight },
      { stayHidden: true },
    );
    if (!activeCaptureIsCurrent(projectPath, job)) {
      throw new Error("Capture superseded");
    }
    if (isBlankCapture(image)) {
      return { ok: false, error: "Blank capture" };
    }

    const png = image.resize({ width: 640 }).toPNG();
    const projectPaths = projectThumbPaths(userData, projectPath);
    fs.mkdirSync(path.dirname(projectPaths.png), { recursive: true });
    fs.writeFileSync(projectPaths.png, png);
    writePageThumbPng(userData, projectPath, route, png, opts.mtimeMs);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (activeCaptureJobs.get(projectPath) === job) {
      activeCaptureJobs.delete(projectPath);
    }
    destroyCaptureWindow(win);
  }
}

type WarmJob = {
  generation: number;
  cancelled: boolean;
  kind?: "pages" | "components" | "layouts";
  projectPath?: string;
  pending?: WarmComponent[];
};

let warmJob: WarmJob | null = null;
let warmWindow: BrowserWindowType | null = null;
let warmGeneration = 0;

function destroyWarmWindow(): void {
  if (!warmWindow) return;
  const win = warmWindow;
  warmWindow = null;
  try {
    if (!win.isDestroyed()) win.destroy();
  } catch {
    /* already gone */
  }
}

function ensureWarmWindow(): BrowserWindowType {
  if (warmWindow && !warmWindow.isDestroyed()) return warmWindow;
  warmWindow = new BrowserWindow({
    width: WARM_VIEWPORT.width,
    height: WARM_VIEWPORT.height,
    show: false,
    paintWhenInitiallyHidden: true,
    skipTaskbar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      images: true,
      webSecurity: true,
    },
  });
  warmWindow.webContents.setAudioMuted(true);
  warmWindow.webContents.setBackgroundThrottling(false);
  warmWindow.on("closed", () => {
    warmWindow = null;
  });
  return warmWindow;
}

function loadUrlInWarmWindow(
  win: BrowserWindowType,
  url: string,
  job: WarmJob,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (job.cancelled || win.isDestroyed()) {
      reject(new Error("cancelled"));
      return;
    }
    const { webContents } = win;
    let settled = false;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Thumbnail warm load timed out"));
    }, WARM_LOAD_TIMEOUT_MS);

    const cleanup = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      webContents.removeListener("did-finish-load", onLoad);
      webContents.removeListener("did-fail-load", onFail);
    };

    const onLoad = () => {
      cleanup();
      resolve();
    };
    const onFail = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
    ) => {
      // -3 ERR_ABORTED is expected when navigating to the next route.
      if (errorCode === -3) return;
      cleanup();
      reject(new Error(errorDescription || "Failed to load page"));
    };

    webContents.on("did-finish-load", onLoad);
    webContents.on("did-fail-load", onFail);
    void win.loadURL(url).catch((error: unknown) => {
      if (settled) return;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    });
  });
}

function delay(ms: number, job: WarmJob): Promise<void> {
  return new Promise((resolve, reject) => {
    if (job.cancelled) {
      reject(new Error("cancelled"));
      return;
    }
    const timer = setTimeout(() => {
      if (job.cancelled) reject(new Error("cancelled"));
      else resolve();
    }, ms);
    // Best-effort: if cancelled mid-wait, still resolve/reject via next check.
    void timer;
  });
}

async function waitForComponentPreviewReady(
  win: BrowserWindowType,
  url: string,
  id: string,
  job: WarmJob,
): Promise<boolean> {
  const deadline = Date.now() + WARM_LOAD_TIMEOUT_MS;
  let lastReloadAt = Date.now();
  let reloads = 0;

  while (Date.now() < deadline) {
    if (job.cancelled || warmJob !== job || win.isDestroyed()) {
      throw new Error("cancelled");
    }
    const state = (await win.webContents
      .executeJavaScript(componentPreviewReadyScript(id, COMPONENT_THUMB_VERSION))
      .catch(() => "wait")) as string;
    if (state === "ok") {
      await win.webContents
        .executeJavaScript(COMPONENT_PREVIEW_PAINT_SCRIPT)
        .catch(() => undefined);
      return true;
    }
    if (
      state === "stale" &&
      reloads < COMPONENT_STALE_RELOAD_MAX &&
      Date.now() - lastReloadAt >= COMPONENT_STALE_RELOAD_MS
    ) {
      lastReloadAt = Date.now();
      reloads += 1;
      await loadUrlInWarmWindow(win, url, job).catch(() => undefined);
      continue;
    }
    await delay(COMPONENT_READY_POLL_MS, job);
  }
  return false;
}

/** Reorder pending component captures. Does not cancel the in-flight item. */
export function prioritizeComponentThumbs(
  projectPath: string,
  ids: readonly string[],
): { ok: true } {
  const job = warmJob;
  if (!job || job.cancelled || job.kind !== "components") return { ok: true };
  const root = projectPath.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  const jobRoot = (job.projectPath ?? "").replace(/\\/g, "/").replace(/\/+$/, "");
  if (!root || root !== jobRoot) return { ok: true };
  if (!job.pending?.length) return { ok: true };
  const next = prioritizeWarmQueue(job.pending, ids);
  job.pending.splice(0, job.pending.length, ...next);
  return { ok: true };
}

/** Cancel any in-flight background thumb warm (pages or components). */
export function cancelWarmThumbs(): void {
  if (warmJob) warmJob.cancelled = true;
  warmJob = null;
  destroyWarmWindow();
}

/** @deprecated Prefer cancelWarmThumbs — shared cancel for page + component warm. */
export function cancelWarmPageThumbs(): void {
  cancelWarmThumbs();
  cancelActiveThumbCaptures();
}

/**
 * Quietly load each project route in a hidden window and write page thumbs.
 * Skips routes that already have a fresh thumb. Does not overwrite the
 * Control-room project thumb (Stage capture owns that).
 */
export async function warmPageThumbs(
  userData: string,
  opts: {
    projectPath: string;
    baseUrl: string;
    pages: WarmPage[];
  },
): Promise<WarmPagesResult> {
  const projectPath = opts.projectPath.trim();
  const baseUrl = opts.baseUrl.trim().replace(/\/+$/, "");
  if (!projectPath) return { captured: 0, skipped: 0, cancelled: false };
  if (!isAllowedPreviewBase(baseUrl)) {
    return { captured: 0, skipped: 0, cancelled: false };
  }

  cancelWarmThumbs();
  const generation = ++warmGeneration;
  const job: WarmJob = { generation, cancelled: false };
  warmJob = job;

  let captured = 0;
  let skipped = 0;

  try {
    const win = ensureWarmWindow();
    for (const page of opts.pages) {
      if (job.cancelled || warmJob !== job) {
        return { captured, skipped, cancelled: true };
      }
      const route = (page.route?.trim() || "/") as string;
      if (!isWarmableRoute(route)) {
        skipped += 1;
        continue;
      }
      if (pageThumbIsFresh(userData, projectPath, route, page.mtimeMs)) {
        skipped += 1;
        continue;
      }
      const url = pagePreviewUrl(baseUrl, route);
      if (!url) {
        skipped += 1;
        continue;
      }

      try {
        await loadUrlInWarmWindow(win, url, job);
        await delay(WARM_SETTLE_MS, job);
        if (job.cancelled || warmJob !== job || win.isDestroyed()) {
          return { captured, skipped, cancelled: true };
        }
        const image = await win.webContents.capturePage();
        if (isBlankCapture(image)) continue;
        const png = image.resize({ width: 640 }).toPNG();
        writePageThumbPng(userData, projectPath, route, png, page.mtimeMs);
        captured += 1;
      } catch {
        if (job.cancelled || warmJob !== job) {
          return { captured, skipped, cancelled: true };
        }
        // Keep going — one bad route shouldn't abort the rest.
      }
    }
  } finally {
    if (warmJob === job) {
      warmJob = null;
      destroyWarmWindow();
    } else if (generation === warmGeneration) {
      destroyWarmWindow();
    }
  }

  return { captured, skipped, cancelled: false };
}

/**
 * Quietly render each component via the Aria catalog harness and write thumbs.
 * Writes the harness once per job, then navigates with `?id=` and waits for
 * a matching preview-ok stamp instead of sleeping between captures.
 */
export async function warmComponentThumbs(
  userData: string,
  opts: {
    projectPath: string;
    baseUrl: string;
    components: WarmComponent[];
  },
): Promise<WarmComponentsResult> {
  const projectPath = opts.projectPath.trim();
  const baseUrl = opts.baseUrl.trim().replace(/\/+$/, "");
  if (!projectPath) return { captured: 0, skipped: 0, cancelled: false };
  if (!isAllowedPreviewBase(baseUrl)) {
    return { captured: 0, skipped: 0, cancelled: false };
  }

  const pending: WarmComponent[] = [];
  let skipped = 0;
  for (const component of opts.components) {
    const id = (component.id?.trim() || "").replace(/\\/g, "/");
    if (!isSafeComponentId(id)) {
      skipped += 1;
      continue;
    }
    if (componentThumbIsFresh(userData, projectPath, id, component.mtimeMs)) {
      skipped += 1;
      continue;
    }
    pending.push({ id, mtimeMs: component.mtimeMs });
  }
  if (!pending.length) {
    return { captured: 0, skipped, cancelled: false };
  }

  cancelWarmThumbs();
  const generation = ++warmGeneration;
  const job: WarmJob = {
    generation,
    cancelled: false,
    kind: "components",
    projectPath,
    pending,
  };
  warmJob = job;

  let captured = 0;

  try {
    try {
      ensureComponentPreviewHarness(
        projectPath,
        pending.map((component) => component.id),
      );
    } catch {
      return { captured: 0, skipped: skipped + pending.length, cancelled: false };
    }

    const win = ensureWarmWindow();

    while (pending.length) {
      if (job.cancelled || warmJob !== job) {
        return { captured, skipped, cancelled: true };
      }
      const component = pending.shift()!;
      const id = component.id;
      const url = buildComponentPreviewUrl(baseUrl, id);
      if (!url) {
        skipped += 1;
        continue;
      }

      try {
        await loadUrlInWarmWindow(win, url, job);
        const previewOk = await waitForComponentPreviewReady(win, url, id, job);
        if (job.cancelled || warmJob !== job || win.isDestroyed()) {
          return { captured, skipped, cancelled: true };
        }
        if (!previewOk) {
          skipped += 1;
          continue;
        }
        const image = await win.webContents.capturePage();
        if (isBlankCapture(image)) continue;
        const png = image.resize({ width: 640 }).toPNG();
        writeComponentThumbPng(
          userData,
          projectPath,
          id,
          png,
          component.mtimeMs,
        );
        captured += 1;
      } catch {
        if (job.cancelled || warmJob !== job) {
          return { captured, skipped, cancelled: true };
        }
        skipped += 1;
      }
    }
  } finally {
    if (warmJob === job) {
      warmJob = null;
      destroyWarmWindow();
    } else if (generation === warmGeneration) {
      destroyWarmWindow();
    }
  }

  return { captured, skipped, cancelled: false };
}

/** Warm real consumer pages and synthetic layout specimens in one owned job. */
export async function warmLayoutThumbs(
  userData: string,
  opts: {
    projectPath: string;
    baseUrl: string;
    pages: WarmPage[];
    layouts: WarmLayout[];
  },
): Promise<WarmLayoutsResult> {
  const projectPath = opts.projectPath.trim();
  const baseUrl = opts.baseUrl.trim().replace(/\/+$/, "");
  if (!projectPath || !isAllowedPreviewBase(baseUrl)) {
    return { captured: 0, skipped: 0, cancelled: false };
  }

  cancelWarmThumbs();
  const generation = ++warmGeneration;
  const job: WarmJob = { generation, cancelled: false };
  warmJob = job;
  let captured = 0;
  let skipped = 0;

  try {
    const win = ensureWarmWindow();
    for (const page of opts.pages) {
      if (job.cancelled || warmJob !== job) {
        return { captured, skipped, cancelled: true };
      }
      const route = page.route?.trim() || "/";
      if (
        !isWarmableRoute(route) ||
        pageThumbIsFresh(userData, projectPath, route, page.mtimeMs)
      ) {
        skipped += 1;
        continue;
      }
      const url = pagePreviewUrl(baseUrl, route);
      if (!url) {
        skipped += 1;
        continue;
      }
      try {
        await loadUrlInWarmWindow(win, url, job);
        await delay(WARM_SETTLE_MS, job);
        if (job.cancelled || warmJob !== job || win.isDestroyed()) {
          return { captured, skipped, cancelled: true };
        }
        const image = await win.webContents.capturePage();
        if (isBlankCapture(image)) {
          skipped += 1;
          continue;
        }
        writePageThumbPng(
          userData,
          projectPath,
          route,
          image.resize({ width: 640 }).toPNG(),
          page.mtimeMs,
        );
        captured += 1;
      } catch {
        if (job.cancelled || warmJob !== job) {
          return { captured, skipped, cancelled: true };
        }
        skipped += 1;
      }
    }

    for (const layout of opts.layouts) {
      if (job.cancelled || warmJob !== job) {
        return { captured, skipped, cancelled: true };
      }
      const id = (layout.id?.trim() || "").replace(/\\/g, "/");
      if (!isSafeLayoutId(id)) {
        skipped += 1;
        continue;
      }
      if (layoutThumbIsFresh(userData, projectPath, id, layout.mtimeMs)) {
        skipped += 1;
        continue;
      }

      let harnessWritten = false;
      try {
        harnessWritten = (await ensureLayoutPreviewHarness(projectPath, id)).written;
      } catch {
        skipped += 1;
        continue;
      }
      const url = layoutPreviewUrl(baseUrl);
      if (!url) {
        skipped += 1;
        continue;
      }

      try {
        if (harnessWritten) await delay(HARNESS_HMR_SETTLE_MS, job);
        await loadUrlInWarmWindow(win, url, job);
        await delay(WARM_SETTLE_MS, job);
        if (job.cancelled || warmJob !== job || win.isDestroyed()) {
          return { captured, skipped, cancelled: true };
        }
        const previewOk = await win.webContents
          .executeJavaScript(
            `(() => {
              if (document.title === "Error") return false;
              if (document.querySelector("vite-error-overlay")) return false;
              return document.documentElement.dataset.ariaLayoutPreview === ${JSON.stringify(id)};
            })()`,
          )
          .catch(() => false);
        if (!previewOk) {
          skipped += 1;
          continue;
        }
        const image = await win.webContents.capturePage();
        if (isBlankCapture(image)) {
          skipped += 1;
          continue;
        }
        writeLayoutThumbPng(
          userData,
          projectPath,
          id,
          image.resize({ width: 640 }).toPNG(),
          layout.mtimeMs,
        );
        captured += 1;
      } catch {
        if (job.cancelled || warmJob !== job) {
          return { captured, skipped, cancelled: true };
        }
        skipped += 1;
      }
    }
  } finally {
    if (warmJob === job) {
      warmJob = null;
      destroyWarmWindow();
    } else if (generation === warmGeneration) {
      destroyWarmWindow();
    }
  }

  return { captured, skipped, cancelled: false };
}

/**
 * Return the last stored page thumb, if any.
 * `mtimeMs` is accepted for API compatibility but does not hide a stored
 * thumb — callers keep showing the last capture until a new one is written.
 */
export function getPageThumb(
  userData: string,
  projectPath: string,
  route: string,
  _mtimeMs?: number | null,
): ThumbGetResult {
  const paths = pageThumbPaths(userData, projectPath.trim(), route.trim() || "/");
  const dataUrl = readDataUrl(paths.png);
  return dataUrl ? { dataUrl } : null;
}

/**
 * Return the last stored component thumb, if any.
 * Hides captures from older harness versions so broken error-overlay thumbs
 * do not linger after a harness fix.
 */
export function getComponentThumb(
  userData: string,
  projectPath: string,
  id: string,
  _mtimeMs?: number | null,
): ThumbGetResult {
  const normalized = id.trim().replace(/\\/g, "/");
  if (!isSafeComponentId(normalized)) return null;
  const paths = componentThumbPaths(userData, projectPath.trim(), normalized);
  const meta = readComponentMeta(paths.meta);
  if (!meta || meta.version !== COMPONENT_THUMB_VERSION) return null;
  const dataUrl = readDataUrl(paths.png);
  return dataUrl ? { dataUrl } : null;
}

export function getLayoutThumb(
  userData: string,
  projectPath: string,
  id: string,
  _mtimeMs?: number | null,
): ThumbGetResult {
  const normalized = id.trim().replace(/\\/g, "/");
  if (!isSafeLayoutId(normalized)) return null;
  const paths = layoutThumbPaths(userData, projectPath.trim(), normalized);
  const meta = readComponentMeta(paths.meta);
  if (!meta || meta.version !== LAYOUT_THUMB_VERSION) return null;
  const dataUrl = readDataUrl(paths.png);
  return dataUrl ? { dataUrl } : null;
}

export function getProjectThumb(
  userData: string,
  projectPath: string,
): ThumbGetResult {
  const paths = projectThumbPaths(userData, projectPath.trim());
  const dataUrl = readDataUrl(paths.png);
  return dataUrl ? { dataUrl } : null;
}

/** Remove project + page + component + layout thumbs for a dismissed recent. */
export function removeProjectThumbs(
  userData: string,
  projectPath: string,
): void {
  const trimmed = projectPath.trim();
  if (!trimmed) return;
  try {
    const projectPaths = projectThumbPaths(userData, trimmed);
    fs.rmSync(projectPaths.png, { force: true });
    fs.rmSync(projectPaths.meta, { force: true });
  } catch {
    /* non-fatal */
  }
  try {
    const pagesDir = path.join(
      thumbsRoot(userData),
      "pages",
      projectHash(trimmed),
    );
    fs.rmSync(pagesDir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
  try {
    const componentsDir = path.join(
      thumbsRoot(userData),
      "components",
      projectHash(trimmed),
    );
    fs.rmSync(componentsDir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
  try {
    const layoutsDir = path.join(
      thumbsRoot(userData),
      "layouts",
      projectHash(trimmed),
    );
    fs.rmSync(layoutsDir, { recursive: true, force: true });
  } catch {
    /* non-fatal */
  }
}
