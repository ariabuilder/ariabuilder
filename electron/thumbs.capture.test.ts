import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronMock = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>;
    destroyed: boolean;
    loadedUrl: string;
    webContents: {
      capturePage: ReturnType<typeof vi.fn>;
      executeJavaScript: ReturnType<typeof vi.fn>;
      emit: (event: string, ...args: unknown[]) => boolean;
    };
  }>,
  autoFinishLoad: true,
  blankNextCapture: false,
  readyResult: { ok: true, error: undefined } as {
    ok: boolean;
    error?: string;
  },
}));

vi.mock("./electron-api", async () => {
  const { EventEmitter } = await import("node:events");

  function captureImage(blank: boolean) {
    const bitmap = Buffer.alloc(48 * 30 * 4);
    for (let i = 0; i < bitmap.length; i += 4) {
      const value = (i / 4) % 2 === 0 ? 20 : 230;
      bitmap[i] = value;
      bitmap[i + 1] = value;
      bitmap[i + 2] = value;
      bitmap[i + 3] = 255;
    }
    return {
      isEmpty: () => blank,
      resize: () => ({
        toBitmap: () => bitmap,
        toPNG: () => Buffer.from("clean-page-thumbnail"),
      }),
    };
  }

  class MockWebContents extends EventEmitter {
    destroyed = false;
    currentUrl = "about:blank";
    capturePage: ReturnType<typeof vi.fn>;

    constructor(blank: boolean) {
      super();
      this.capturePage = vi.fn(async () => captureImage(blank));
    }

    isDestroyed() {
      return this.destroyed;
    }

    setAudioMuted() {}

    setBackgroundThrottling() {}

    getURL() {
      return this.currentUrl;
    }

    executeJavaScript = vi.fn(async () => electronMock.readyResult);
  }

  class MockBrowserWindow extends EventEmitter {
    options: Record<string, unknown>;
    destroyed = false;
    loadedUrl = "";
    webContents: MockWebContents;

    constructor(options: Record<string, unknown>) {
      super();
      this.options = options;
      this.webContents = new MockWebContents(electronMock.blankNextCapture);
      electronMock.blankNextCapture = false;
      electronMock.instances.push(this);
    }

    isDestroyed() {
      return this.destroyed;
    }

    async loadURL(url: string) {
      this.loadedUrl = url;
      this.webContents.currentUrl = url;
      if (electronMock.autoFinishLoad) {
        queueMicrotask(() => this.webContents.emit("did-finish-load"));
      }
    }

    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      this.webContents.destroyed = true;
      this.emit("closed");
    }
  }

  return { BrowserWindow: MockBrowserWindow };
});

import {
  cancelActiveThumbCaptures,
  captureThumbs,
  getPageThumb,
  getProjectThumb,
  PAGE_THUMB_VERSION,
} from "./thumbs";

const tempDirs: string[] = [];

function tempUserData(): string {
  const dir = fs.mkdtempSync(
    path.join(os.tmpdir(), "aria-thumb-capture-test-"),
  );
  tempDirs.push(dir);
  return dir;
}

function request(projectPath = "/project") {
  return {
    projectPath,
    baseUrl: "http://127.0.0.1:4321/?stale=1#aria-design",
    route: "/about",
    viewport: { width: 768, height: 1024 },
    captureHeight: 576,
    mtimeMs: 123,
  };
}

afterEach(() => {
  cancelActiveThumbCaptures();
  electronMock.instances.splice(0);
  electronMock.autoFinishLoad = true;
  electronMock.blankNextCapture = false;
  electronMock.readyResult = { ok: true, error: undefined };
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vi.clearAllMocks();
});

describe("clean page thumbnail capture", () => {
  it("renders a sanitized route in a hidden final-size window", async () => {
    const userData = tempUserData();
    const result = await captureThumbs(userData, request());

    expect(result).toEqual({ ok: true });
    const win = electronMock.instances[0]!;
    expect(win.options).toMatchObject({
      width: 768,
      height: 1024,
      useContentSize: true,
      frame: false,
      show: false,
      paintWhenInitiallyHidden: true,
      focusable: false,
      webPreferences: expect.objectContaining({ offscreen: true }),
    });
    expect(win.loadedUrl).toBe("http://127.0.0.1:4321/about");
    expect(win.webContents.capturePage).toHaveBeenCalledWith(
      { x: 0, y: 0, width: 768, height: 576 },
    );
    const readyScript = win.webContents.executeJavaScript.mock.calls[0]![0];
    expect(readyScript).toContain("vite-error-overlay");
    expect(readyScript).toContain("document.fonts");
    expect(readyScript).toContain("document.images");
    expect(readyScript).toContain("requestAnimationFrame");
    expect(win.destroyed).toBe(true);
    expect(getPageThumb(userData, "/project", "/about")).toEqual({
      dataUrl: `data:image/png;base64,${Buffer.from("clean-page-thumbnail").toString("base64")}`,
    });
    expect(getProjectThumb(userData, "/project")).toEqual(
      getPageThumb(userData, "/project", "/about"),
    );

    const pagesRoot = path.join(userData, "thumbs", "pages");
    const projectDir = path.join(pagesRoot, fs.readdirSync(pagesRoot)[0]!);
    const metaFile = fs
      .readdirSync(projectDir)
      .find((file) => file.endsWith(".json"));
    const meta = JSON.parse(
      fs.readFileSync(path.join(projectDir, metaFile!), "utf8"),
    );
    expect(meta.version).toBe(PAGE_THUMB_VERSION);
  });

  it("supersedes an older capture for the same project", async () => {
    const userData = tempUserData();
    electronMock.autoFinishLoad = false;
    const older = captureThumbs(userData, request());
    await Promise.resolve();

    electronMock.autoFinishLoad = true;
    const newer = captureThumbs(userData, request());
    const [olderResult, newerResult] = await Promise.all([older, newer]);

    expect(olderResult).toEqual({ ok: false, error: "Capture cancelled" });
    expect(newerResult).toEqual({ ok: true });
    expect(electronMock.instances[0]!.destroyed).toBe(true);
    expect(
      electronMock.instances[0]!.webContents.capturePage,
    ).not.toHaveBeenCalled();
    expect(
      electronMock.instances[1]!.webContents.capturePage,
    ).toHaveBeenCalledOnce();
  });

  it("ignores subframe failures and aborted navigations", async () => {
    const userData = tempUserData();
    electronMock.autoFinishLoad = false;
    const capture = captureThumbs(userData, request());
    await Promise.resolve();

    const win = electronMock.instances[0]!;
    win.webContents.emit(
      "did-fail-load",
      {},
      -105,
      "NAME_NOT_RESOLVED",
      "http://invalid.test/frame",
      false,
    );
    win.webContents.emit(
      "did-fail-load",
      {},
      -3,
      "ERR_ABORTED",
      win.loadedUrl,
      true,
    );
    win.webContents.emit("did-finish-load");

    await expect(capture).resolves.toEqual({ ok: true });
  });

  it("keeps the last good thumbnail when a later capture is blank", async () => {
    const userData = tempUserData();
    expect(await captureThumbs(userData, request())).toEqual({ ok: true });
    const previous = getPageThumb(userData, "/project", "/about");

    electronMock.blankNextCapture = true;
    expect(await captureThumbs(userData, request())).toEqual({
      ok: false,
      error: "Blank capture",
    });
    expect(getPageThumb(userData, "/project", "/about")).toEqual(previous);
    expect(getProjectThumb(userData, "/project")).toEqual(previous);
  });

  it("keeps the last good thumbnail when readiness fails", async () => {
    const userData = tempUserData();
    expect(await captureThumbs(userData, request())).toEqual({ ok: true });
    const previous = getPageThumb(userData, "/project", "/about");

    electronMock.readyResult = {
      ok: false,
      error: "Preview error overlay",
    };
    expect(await captureThumbs(userData, request())).toEqual({
      ok: false,
      error: "Preview error overlay",
    });
    expect(getPageThumb(userData, "/project", "/about")).toEqual(previous);
    expect(getProjectThumb(userData, "/project")).toEqual(previous);
    expect(
      electronMock.instances[1]!.webContents.capturePage,
    ).not.toHaveBeenCalled();
  });
});
