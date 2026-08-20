import { COMPONENT_PREVIEW_ROUTE } from "../componentPreviewHarness";

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

function isThumbComponentId(id: string): boolean {
  const normalized = id.trim().replace(/\\/g, "/");
  return (
    normalized.startsWith("src/components/") &&
    !normalized.includes("..") &&
    !normalized.includes("\0")
  );
}

/** Hidden-window URL for the catalog thumbnail harness. */
export function buildComponentPreviewUrl(
  baseUrl: string,
  componentId: string,
  cacheBustMs = Date.now(),
): string | null {
  const id = componentId.trim().replace(/\\/g, "/");
  if (!isThumbComponentId(id)) return null;
  try {
    const url = new URL(baseUrl);
    if (!isAllowedPreviewBase(url.toString())) return null;
    url.pathname = COMPONENT_PREVIEW_ROUTE;
    url.hash = "";
    url.search = "";
    url.searchParams.set("id", id);
    url.searchParams.set("t", String(cacheBustMs));
    return url.toString();
  } catch {
    return null;
  }
}

/** Probe the catalog harness DOM. Returns ok | wait | stale | error. */
export function componentPreviewReadyScript(id: string, version: number): string {
  return `(() => {
    if (document.title === "Error") return "error";
    if (document.querySelector("vite-error-overlay")) return "error";
    const versionStamp =
      document.documentElement.getAttribute("data-aria-component-thumb-version") || "";
    if (versionStamp !== ${JSON.stringify(String(version))}) return "stale";
    const root = document.querySelector("[data-aria-component-preview]");
    if (!root) return "wait";
    if ((root.getAttribute("data-aria-component-preview") || "") !== ${JSON.stringify(id)}) {
      return "wait";
    }
    if (root.getAttribute("data-aria-component-preview-ok") !== "1") return "wait";
    return "ok";
  })()`;
}

/** Fonts, two animation frames, and image decode — capped at 2s. */
export const COMPONENT_PREVIEW_PAINT_SCRIPT = `(async () => {
  const paint = Promise.all([
    document.fonts ? document.fonts.ready.catch(() => undefined) : Promise.resolve(),
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  ]);
  const images = Promise.all([...document.images].map((img) => {
    if (typeof img.decode === "function") return img.decode().catch(() => undefined);
    return Promise.resolve();
  }));
  await Promise.race([
    Promise.all([paint, images]),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
})()`;
