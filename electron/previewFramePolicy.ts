/**
 * Composer embeds Astro in a sandboxed <iframe>. Real user sites often send
 * X-Frame-Options: DENY or CSP frame-ancestors 'none' — correct for production,
 * fatal for in-app preview. Aria absorbs that at the Electron session layer
 * instead of asking users to edit middleware.
 *
 * Scope: loopback preview hosts + subframe navigations only. System-browser
 * opens keep the project's real headers.
 */

export type HeaderMap = Record<string, string | string[]>;

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** Chromium webRequest filter patterns for local Astro previews. */
export const PREVIEW_FRAME_BYPASS_URLS = [
  "http://127.0.0.1:*/*",
  "http://localhost:*/*",
  "http://[::1]:*/*",
] as const;

export function isLoopbackPreviewUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

function previewOrigin(url: string): string | null {
  if (!isLoopbackPreviewUrl(url)) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Keep app-window navigation locked down while allowing a project preview
 * iframe to follow server redirects on its own active Astro origin.
 */
export function shouldAllowWindowRedirect(input: {
  isMainFrame: boolean;
  destinationUrl: string;
  trustedMainFrameUrl: boolean;
  activePreviewUrls: readonly (string | null | undefined)[];
}): boolean {
  if (input.isMainFrame) return input.trustedMainFrameUrl;
  const destinationOrigin = previewOrigin(input.destinationUrl);
  if (!destinationOrigin) return false;
  return input.activePreviewUrls.some(
    (previewUrl) =>
      typeof previewUrl === "string" &&
      previewOrigin(previewUrl) === destinationOrigin,
  );
}

/**
 * Drop CSP `frame-ancestors` so Chromium will allow the Composer iframe.
 * Leaves every other directive intact.
 */
export function stripFrameAncestorsFromCsp(value: string): string {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !/^frame-ancestors\b/i.test(part))
    .join("; ");
}

function findHeaderKey(headers: HeaderMap, name: string): string | null {
  const target = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) return key;
  }
  return null;
}

function mapHeaderValues(
  value: string | string[],
  map: (entry: string) => string,
): string | string[] {
  if (Array.isArray(value)) return value.map(map);
  return map(value);
}

function ensureHtmlCharset(value: string): string {
  if (!/^\s*text\/html(?:\s*;|\s*$)/i.test(value)) return value;
  if (/;\s*charset\s*=/i.test(value)) return value;
  return `${value}; charset=utf-8`;
}

/**
 * Rewrite response headers so a loopback Astro document can load inside
 * Composer's iframe without mutating the user's project.
 */
export function softenPreviewFrameHeaders(headers: HeaderMap | undefined): HeaderMap {
  if (!headers) return {};
  const next: HeaderMap = { ...headers };

  const xfo = findHeaderKey(next, "x-frame-options");
  if (xfo) delete next[xfo];

  // Marker templates can push a project's <meta charset> beyond Chromium's
  // encoding-sniff window. Keep the user's explicit charset when present,
  // otherwise make the loopback HTML document unambiguously UTF-8.
  const contentType = findHeaderKey(next, "content-type");
  if (contentType) {
    next[contentType] = mapHeaderValues(next[contentType]!, ensureHtmlCharset);
  }

  for (const name of [
    "content-security-policy",
    "content-security-policy-report-only",
  ] as const) {
    const key = findHeaderKey(next, name);
    if (!key) continue;
    const rewritten = mapHeaderValues(next[key]!, stripFrameAncestorsFromCsp);
    const empty = Array.isArray(rewritten)
      ? rewritten.every((part) => !part.trim())
      : !rewritten.trim();
    if (empty) delete next[key];
    else next[key] = rewritten;
  }

  return next;
}

export type HeadersReceivedDetails = {
  url: string;
  resourceType?: string;
  responseHeaders?: HeaderMap;
};

export type HeadersReceivedCallback = (response: {
  cancel?: boolean;
  responseHeaders?: HeaderMap;
}) => void;

/**
 * webRequest handler: only softens framing headers for loopback preview
 * documents loaded as Composer subframes.
 */
export function handlePreviewFrameHeaders(
  details: HeadersReceivedDetails,
  callback: HeadersReceivedCallback,
): void {
  // Prefer subframe-only rewrites. When Electron omits resourceType, still
  // gate on loopback URL (filter already restricts the listener).
  if (details.resourceType && details.resourceType !== "subFrame") {
    callback({ responseHeaders: details.responseHeaders });
    return;
  }
  if (!isLoopbackPreviewUrl(details.url)) {
    callback({ responseHeaders: details.responseHeaders });
    return;
  }
  callback({
    responseHeaders: softenPreviewFrameHeaders(details.responseHeaders),
  });
}

type ElectronSession = {
  webRequest: {
    onHeadersReceived: (
      filter: { urls: string[] },
      listener: (
        details: HeadersReceivedDetails,
        callback: HeadersReceivedCallback,
      ) => void,
    ) => void;
  };
};

let installed = false;

/** Install once on the app session used by Composer iframes. */
export function installPreviewFrameBypass(session: ElectronSession): void {
  if (installed) return;
  installed = true;
  session.webRequest.onHeadersReceived(
    { urls: [...PREVIEW_FRAME_BYPASS_URLS] },
    handlePreviewFrameHeaders,
  );
}

/** Test helper — allow re-install in unit tests. */
export function resetPreviewFrameBypassForTests(): void {
  installed = false;
}
