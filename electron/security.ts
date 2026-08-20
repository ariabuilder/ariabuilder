import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrowserWindow,
  type BrowserWindow as BrowserWindowType,
  type IpcMainInvokeEvent,
} from "./electron-api";

export type TrustedWindowConfig = {
  /** True when the BrowserWindow is an Aria app window. */
  isAppWindow: (window: BrowserWindowType) => boolean;
  appRoot: string;
  isDev: boolean;
  devUrl: string;
  rendererToken?: string;
  trustedRenderers?: Set<number>;
  requireHandshake?: boolean;
};

function normalizedDevOrigin(devUrl: string): string | null {
  try {
    const url = new URL(devUrl);
    if (
      url.protocol !== "http:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function isTrustedAppUrl(
  value: string,
  config: Pick<TrustedWindowConfig, "appRoot" | "isDev" | "devUrl">,
): boolean {
  if (config.isDev) {
    const origin = normalizedDevOrigin(config.devUrl);
    try {
      return origin !== null && new URL(value).origin === origin;
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "file:") return false;
    if (url.host) return false;
    const filePath = fs.realpathSync(fileURLToPath(url));
    const root = fs.realpathSync(config.appRoot);
    const relative = path.relative(root, filePath);
    return relative === "" || (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  } catch {
    return false;
  }
}

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function assertTrustedIpc(
  event: IpcMainInvokeEvent,
  config: TrustedWindowConfig,
): void {
  const senderWindow = BrowserWindow.fromWebContents(event.sender);
  if (
    !senderWindow ||
    senderWindow.isDestroyed() ||
    !config.isAppWindow(senderWindow)
  ) {
    throw new Error("Untrusted IPC sender");
  }

  if (event.senderFrame !== event.sender.mainFrame) {
    throw new Error("IPC is only available to the main frame");
  }

  if (!isTrustedAppUrl(event.senderFrame.url, config)) {
    throw new Error("Untrusted IPC origin");
  }

  if (
    config.requireHandshake &&
    config.trustedRenderers &&
    !config.trustedRenderers.has(event.sender.id)
  ) {
    throw new Error("Renderer handshake required");
  }
}

export function assertRendererReady(
  event: IpcMainInvokeEvent,
  config: TrustedWindowConfig,
  token: unknown,
): void {
  assertTrustedIpc(event, { ...config, requireHandshake: false });
  if (typeof token !== "string" || token !== (config.rendererToken ?? "")) {
    throw new Error("Invalid renderer handshake");
  }
  config.trustedRenderers?.add(event.sender.id);
}
