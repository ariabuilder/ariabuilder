import type {
  CaptureViewport,
  ComponentThumbReadyPayload,
  LayoutThumbReadyPayload,
  PageThumbReadyPayload,
  ThumbCaptureResult,
  ThumbGetResult,
  WarmPagesResult,
} from "@/types/aria";

export type {
  CaptureViewport,
  ComponentThumbReadyPayload,
  LayoutThumbReadyPayload,
  PageThumbReadyPayload,
  ThumbCaptureResult,
  ThumbGetResult,
  WarmPagesResult,
};

function api() {
  if (!window.aria?.thumbs) {
    throw new Error("Aria desktop bridge is unavailable");
  }
  return window.aria.thumbs;
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function normalizeComponentId(id: string): string {
  return id.trim().replace(/\\/g, "/");
}

function mtimeKey(mtimeMs?: number | null): string {
  return typeof mtimeMs === "number" && Number.isFinite(mtimeMs)
    ? String(mtimeMs)
    : "";
}

function componentThumbCacheKey(
  projectPath: string,
  id: string,
  mtimeMs?: number | null,
): string {
  return `${normalizeProjectPath(projectPath)}|${normalizeComponentId(id)}|${mtimeKey(mtimeMs)}`;
}

function componentThumbIdPrefix(projectPath: string, id: string): string {
  return `${normalizeProjectPath(projectPath)}|${normalizeComponentId(id)}|`;
}

/** Session-lived dataUrl cache — survives Components rail remounts. */
const componentThumbCache = new Map<string, string>();
const layoutThumbCache = new Map<string, string>();

export function peekComponentThumb(opts: {
  projectPath: string;
  id: string;
  mtimeMs?: number | null;
}): string | null {
  return (
    componentThumbCache.get(
      componentThumbCacheKey(opts.projectPath, opts.id, opts.mtimeMs),
    ) ?? null
  );
}

export function setComponentThumbCache(opts: {
  projectPath: string;
  id: string;
  mtimeMs?: number | null;
  dataUrl: string;
}): void {
  const key = componentThumbCacheKey(opts.projectPath, opts.id, opts.mtimeMs);
  componentThumbCache.set(key, opts.dataUrl);
}

/** Drop all cached thumbs for a component id (any mtime). */
export function invalidateComponentThumbCache(opts: {
  projectPath: string;
  id: string;
}): void {
  const prefix = componentThumbIdPrefix(opts.projectPath, opts.id);
  for (const key of componentThumbCache.keys()) {
    if (key.startsWith(prefix)) {
      componentThumbCache.delete(key);
    }
  }
}

export function captureThumbs(opts: {
  projectPath: string;
  baseUrl: string;
  route: string;
  viewport: CaptureViewport;
  captureHeight: number;
  mtimeMs?: number | null;
}): Promise<ThumbCaptureResult> {
  return api().capture(opts);
}

export function getPageThumb(opts: {
  projectPath: string;
  route: string;
  mtimeMs?: number | null;
}): Promise<ThumbGetResult> {
  return api().getPage(opts);
}

export async function getComponentThumb(opts: {
  projectPath: string;
  id: string;
  mtimeMs?: number | null;
}): Promise<ThumbGetResult> {
  const cached = peekComponentThumb(opts);
  if (cached) return { dataUrl: cached };

  const result = await api().getComponent(opts);
  if (result?.dataUrl) {
    setComponentThumbCache({
      projectPath: opts.projectPath,
      id: opts.id,
      mtimeMs: opts.mtimeMs,
      dataUrl: result.dataUrl,
    });
  }
  return result;
}

export async function getLayoutThumb(opts: {
  projectPath: string;
  id: string;
  mtimeMs?: number | null;
}): Promise<ThumbGetResult> {
  const key = componentThumbCacheKey(opts.projectPath, opts.id, opts.mtimeMs);
  const cached = layoutThumbCache.get(key);
  if (cached) return { dataUrl: cached };
  const result = await api().getLayout(opts);
  if (result?.dataUrl) layoutThumbCache.set(key, result.dataUrl);
  return result;
}

export function getProjectThumb(
  projectPath: string,
): Promise<ThumbGetResult> {
  return api().getProject(projectPath);
}

export function warmPageThumbs(opts: {
  projectPath: string;
  baseUrl: string;
  pages: Array<{
    route: string;
    previewRoute?: string | null;
    cacheKey?: string | null;
    mtimeMs?: number | null;
  }>;
}): Promise<WarmPagesResult> {
  return api().warmPages(opts);
}

export function warmComponentThumbs(opts: {
  projectPath: string;
  baseUrl: string;
  components: Array<{ id: string; mtimeMs?: number | null }>;
}): Promise<WarmPagesResult> {
  return api().warmComponents(opts);
}

export function prioritizeComponentThumbs(opts: {
  projectPath: string;
  ids: string[];
}): Promise<{ ok: true }> {
  return api().prioritizeComponents(opts);
}

export function warmLayoutThumbs(opts: {
  projectPath: string;
  baseUrl: string;
  pages: Array<{
    route: string;
    previewRoute?: string | null;
    cacheKey?: string | null;
    mtimeMs?: number | null;
  }>;
  layouts: Array<{ id: string; mtimeMs?: number | null }>;
}): Promise<WarmPagesResult> {
  return api().warmLayouts(opts);
}

export function cancelWarmPageThumbs(): Promise<{ ok: true }> {
  return api().cancelWarm();
}

/** Shared IPC subscription so page and layout grids use one renderer listener. */
const pageReadyHandlers = new Set<(payload: PageThumbReadyPayload) => void>();
let stopPageReadyBridge: (() => void) | null = null;

function ensurePageReadyBridge() {
  if (stopPageReadyBridge) return;
  stopPageReadyBridge = api().onPageReady((payload) => {
    for (const handler of pageReadyHandlers) {
      try {
        handler(payload);
      } catch {
        /* non-fatal */
      }
    }
  });
}

export function onPageThumbReady(
  handler: (payload: PageThumbReadyPayload) => void,
): () => void {
  ensurePageReadyBridge();
  const subscriber = (payload: PageThumbReadyPayload) => handler(payload);
  pageReadyHandlers.add(subscriber);
  return () => {
    pageReadyHandlers.delete(subscriber);
    if (pageReadyHandlers.size === 0 && stopPageReadyBridge) {
      stopPageReadyBridge();
      stopPageReadyBridge = null;
    }
  };
}

/** Shared IPC subscription — avoids MaxListeners with many grid cards. */
const componentReadyHandlers = new Set<
  (payload: ComponentThumbReadyPayload) => void
>();
let stopComponentReadyBridge: (() => void) | null = null;

function ensureComponentReadyBridge() {
  if (stopComponentReadyBridge) return;
  stopComponentReadyBridge = api().onComponentReady((payload) => {
    invalidateComponentThumbCache({
      projectPath: payload.projectPath,
      id: payload.id,
    });
    if (payload.dataUrl) {
      setComponentThumbCache({
        projectPath: payload.projectPath,
        id: payload.id,
        mtimeMs: payload.mtimeMs,
        dataUrl: payload.dataUrl,
      });
    }
    for (const handler of componentReadyHandlers) {
      try {
        handler(payload);
      } catch {
        /* non-fatal */
      }
    }
  });
}

export function onComponentThumbReady(
  handler: (payload: ComponentThumbReadyPayload) => void,
): () => void {
  ensureComponentReadyBridge();
  componentReadyHandlers.add(handler);
  return () => {
    componentReadyHandlers.delete(handler);
    if (componentReadyHandlers.size === 0 && stopComponentReadyBridge) {
      stopComponentReadyBridge();
      stopComponentReadyBridge = null;
    }
  };
}

const layoutReadyHandlers = new Set<
  (payload: LayoutThumbReadyPayload) => void
>();
let stopLayoutReadyBridge: (() => void) | null = null;

export function onLayoutThumbReady(
  handler: (payload: LayoutThumbReadyPayload) => void,
): () => void {
  if (!stopLayoutReadyBridge) {
    stopLayoutReadyBridge = api().onLayoutReady((payload) => {
      const prefix = componentThumbIdPrefix(payload.projectPath, payload.id);
      for (const key of layoutThumbCache.keys()) {
        if (key.startsWith(prefix)) layoutThumbCache.delete(key);
      }
      for (const readyHandler of layoutReadyHandlers) {
        try {
          readyHandler(payload);
        } catch {
          /* non-fatal */
        }
      }
    });
  }
  layoutReadyHandlers.add(handler);
  return () => {
    layoutReadyHandlers.delete(handler);
    if (layoutReadyHandlers.size === 0 && stopLayoutReadyBridge) {
      stopLayoutReadyBridge();
      stopLayoutReadyBridge = null;
    }
  };
}
