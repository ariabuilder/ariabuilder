import { ARIA_DESIGN_HASH, ARIA_DESIGN_QUERY } from "../../shared/composer/constants";

export type PreviewPageUrlOptions = {
  /** Append Composer's design markers for the isolated editor preview. */
  designMode?: boolean;
};

export function previewPageUrl(
  baseUrl: string,
  route: string | null,
  opts?: PreviewPageUrlOptions,
): string | null {
  try {
    const url = new URL(baseUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    )
      return null;
    const pathname = route?.trim() || "/";
    url.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    url.search = "";
    url.hash = "";
    if (opts?.designMode) {
      url.searchParams.set(ARIA_DESIGN_QUERY, "1");
      url.hash = ARIA_DESIGN_HASH;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** True when a MessageEvent origin is the local Astro preview server. */
export function isPreviewMessageOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

/**
 * Whether `win` can receive a postMessage targeted at `origin`.
 * An about:blank iframe inherits the host origin; posting a preview origin
 * at it logs Chromium's target-origin mismatch warning.
 */
export function previewWindowMatchesOrigin(win: Window, origin: string): boolean {
  try {
    return win.location.origin === origin;
  } catch {
    // Cross-origin: the iframe has left the host document.
    return true;
  }
}

export { ARIA_DESIGN_HASH, ARIA_DESIGN_QUERY };
