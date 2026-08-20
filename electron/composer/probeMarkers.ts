import { ARIA_MARKER_END, ARIA_MARKER_START } from "../../shared/composer/constants";
import {
  ARIA_BRIDGE_HEALTH_PATH,
  ARIA_BRIDGE_ID,
  ARIA_PROTOCOL_VERSION,
} from "../../shared/composer/protocol";

export const FOREIGN_SERVER_WARNING =
  "Preview server is not running with Aria selection markers. Restart the server from Aria so design-mode hover/click works.";

export type AriaBridgeProbe = {
  compatible: boolean;
  bridgeId: string | null;
  protocolVersion: number | null;
};

/** Verify the bridge served by the running process, not generated files on disk. */
export async function probeAriaBridge(
  previewUrl: string,
  signal?: AbortSignal,
): Promise<AriaBridgeProbe> {
  const incompatible: AriaBridgeProbe = {
    compatible: false,
    bridgeId: null,
    protocolVersion: null,
  };
  try {
    const url = new URL(ARIA_BRIDGE_HEALTH_PATH, previewUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) return incompatible;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return incompatible;
      const value = await response.json() as {
        bridgeId?: unknown;
        protocolVersion?: unknown;
      };
      const bridgeId = typeof value.bridgeId === "string" ? value.bridgeId : null;
      const protocolVersion = typeof value.protocolVersion === "number"
        ? value.protocolVersion
        : null;
      return {
        compatible:
          bridgeId === ARIA_BRIDGE_ID &&
          protocolVersion === ARIA_PROTOCOL_VERSION,
        bridgeId,
        protocolVersion,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return incompatible;
  }
}

/**
 * Fetch a preview HTML document and look for Aria marker attributes.
 * Used after adopting an existing `astro dev` that may lack our Vite plugin.
 */
export async function probeAriaMarkers(
  previewUrl: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const url = new URL(previewUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return false;
    }
    url.hash = "";
    // Prefer a plain route; markers appear in compiled page HTML.
    const target = url.toString().replace(/\/?$/, "/");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      const response = await fetch(target, {
        signal: controller.signal,
        headers: { Accept: "text/html" },
      });
      if (!response.ok && response.status >= 500) return false;
      const html = await response.text();
      return (
        html.includes(ARIA_MARKER_START) ||
        html.includes(ARIA_MARKER_END) ||
        html.includes("aria-node-markers") ||
        html.includes("design-client.js")
      );
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
    }
  } catch {
    return false;
  }
}
