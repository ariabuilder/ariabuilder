import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "./electron-api";
import { mimeForMediaExt, resolveMediaFilePath } from "./media";
import { requireOpenSession } from "./sessions";

export const ARIA_MEDIA_SCHEME = "aria-media";

/**
 * Must run before app.whenReady().
 * Privileges enable streaming / range requests for <video> and <audio>.
 */
export function registerAriaMediaSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ARIA_MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Build a renderer-safe URL for a project media asset. */
export function buildAriaMediaUrl(
  projectPath: string,
  assetId: string,
): string {
  return `${ARIA_MEDIA_SCHEME}://asset/${encodeURIComponent(projectPath)}/${encodeURIComponent(assetId)}`;
}

/**
 * Resolve a playable streaming URL for an open-session media asset.
 * Validates path safety via resolveMediaFilePath.
 */
export function getPlayableMediaUrl(
  projectPath: string,
  assetId: string,
): { url: string; mimeType: string | null } {
  const root = requireOpenSession(projectPath);
  const absolute = resolveMediaFilePath(root, assetId);
  const ext = path.extname(absolute).toLowerCase();
  return {
    url: buildAriaMediaUrl(root, assetId),
    mimeType: mimeForMediaExt(ext),
  };
}

/** Register the aria-media protocol handler (after app ready). */
export function registerAriaMediaProtocolHandler(): void {
  protocol.handle(ARIA_MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "asset") {
        return new Response("Not Found", { status: 404 });
      }
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts.length !== 2) {
        return new Response("Bad Request", { status: 400 });
      }
      const projectPath = decodeURIComponent(parts[0]!);
      const assetId = decodeURIComponent(parts[1]!);
      const root = requireOpenSession(projectPath);
      const absolute = resolveMediaFilePath(root, assetId);
      return net.fetch(pathToFileURL(absolute).href, {
        method: request.method,
        headers: request.headers,
      });
    } catch {
      return new Response("Forbidden", { status: 403 });
    }
  });
}
