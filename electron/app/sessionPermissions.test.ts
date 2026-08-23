import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Session, WebContents } from "electron";
import { afterEach, describe, expect, it } from "vitest";
import {
  installSessionPermissionPolicy,
  shouldAllowSessionPermission,
} from "./sessionPermissions";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Electron session permissions", () => {
  const devConfig = {
    appRoot: "/app",
    isDev: true,
    devUrl: "http://127.0.0.1:5173",
  };

  it("allows sanitized clipboard writes only from the trusted main frame", () => {
    expect(shouldAllowSessionPermission({
      permission: "clipboard-sanitized-write",
      isMainFrame: true,
      requestingUrl: "http://127.0.0.1:5173/settings",
    }, devConfig)).toBe(true);
    expect(shouldAllowSessionPermission({
      permission: "clipboard-sanitized-write",
      isMainFrame: false,
      requestingUrl: "http://127.0.0.1:4321/preview",
      mainFrameUrl: "http://127.0.0.1:5173",
    }, devConfig)).toBe(false);
    expect(shouldAllowSessionPermission({
      permission: "clipboard-sanitized-write",
      isMainFrame: true,
      requestingUrl: "http://127.0.0.1:4321/preview",
      mainFrameUrl: "http://127.0.0.1:5173",
    }, devConfig)).toBe(false);
    expect(shouldAllowSessionPermission({
      permission: "clipboard-sanitized-write",
      isMainFrame: true,
    }, devConfig)).toBe(false);
  });

  it("recognizes the packaged renderer and denies every other permission", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-permissions-"));
    roots.push(root);
    const renderer = path.join(root, "dist", "index.html");
    fs.mkdirSync(path.dirname(renderer), { recursive: true });
    fs.writeFileSync(renderer, "<!doctype html>");
    const config = { appRoot: root, isDev: false, devUrl: "" };

    expect(shouldAllowSessionPermission({
      permission: "clipboard-sanitized-write",
      isMainFrame: true,
      mainFrameUrl: pathToFileURL(renderer).href,
    }, config)).toBe(true);
    for (const permission of [
      "clipboard-read",
      "media",
      "geolocation",
      "notifications",
      "display-capture",
      "fileSystem",
      "usb",
    ]) {
      expect(shouldAllowSessionPermission({
        permission,
        isMainFrame: true,
        mainFrameUrl: pathToFileURL(renderer).href,
      }, config)).toBe(false);
    }
  });

  it("registers request and check handlers once", () => {
    type RequestHandler = Exclude<
      Parameters<Session["setPermissionRequestHandler"]>[0],
      null
    >;
    type CheckHandler = Exclude<
      Parameters<Session["setPermissionCheckHandler"]>[0],
      null
    >;
    const handlers: {
      request: RequestHandler | null;
      check: CheckHandler | null;
    } = { request: null, check: null };
    let requestRegistrations = 0;
    let checkRegistrations = 0;
    const session = {
      setPermissionRequestHandler(handler: Parameters<Session["setPermissionRequestHandler"]>[0]) {
        handlers.request = handler;
        requestRegistrations += 1;
      },
      setPermissionCheckHandler(handler: Parameters<Session["setPermissionCheckHandler"]>[0]) {
        handlers.check = handler;
        checkRegistrations += 1;
      },
    } as unknown as Session;

    installSessionPermissionPolicy(session, devConfig);
    installSessionPermissionPolicy(session, devConfig);

    expect(requestRegistrations).toBe(1);
    expect(checkRegistrations).toBe(1);

    const webContents = {
      getURL: () => "http://127.0.0.1:5173/settings",
    } as unknown as WebContents;
    if (!handlers.request || !handlers.check) {
      throw new Error("Expected both permission handlers");
    }
    let granted: boolean | undefined;
    handlers.request(
      webContents,
      "clipboard-sanitized-write",
      (value) => { granted = value; },
      { isMainFrame: true, requestingUrl: "http://127.0.0.1:5173/settings" },
    );
    expect(granted).toBe(true);

    expect(handlers.check(
      null,
      "clipboard-sanitized-write",
      "http://127.0.0.1:4321",
      { isMainFrame: false, embeddingOrigin: "http://127.0.0.1:5173" },
    )).toBe(false);
  });
});
