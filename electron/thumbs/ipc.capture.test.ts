import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";
import { registerThumbsIpc } from "./ipc";

const mocks = vi.hoisted(() => ({
  captureThumbs: vi.fn(async () => ({ ok: true as const })),
  getSession: vi.fn(() => ({ previewUrl: "http://127.0.0.1:4321" })),
  requireOpenSession: vi.fn(() => "/project"),
}));

vi.mock("../sessions", () => ({
  getSession: mocks.getSession,
  requireOpenSession: mocks.requireOpenSession,
}));

vi.mock("../thumbs", () => ({
  cancelActiveThumbCaptures: vi.fn(),
  cancelWarmPageThumbs: vi.fn(),
  captureThumbs: mocks.captureThumbs,
  getComponentThumb: vi.fn(),
  getLayoutThumb: vi.fn(),
  getPageThumb: vi.fn(),
  getProjectThumb: vi.fn(),
  prioritizeComponentThumbs: vi.fn(),
  warmComponentThumbs: vi.fn(),
  warmLayoutThumbs: vi.fn(),
  warmPageThumbs: vi.fn(),
}));

type CaptureHandler = (
  event: unknown,
  opts: Record<string, unknown>,
) => unknown;

function captureHandler(): CaptureHandler {
  let capture: CaptureHandler | null = null;
  const registrar = {
    handle(channel: string, listener: CaptureHandler) {
      if (channel === "thumbs:capture") capture = listener;
    },
  } as unknown as IpcRegistrar;
  const context = {
    userDataPath: "/user-data",
    senderWindow: () => null,
  } as unknown as IpcRuntimeContext;
  registerThumbsIpc(registrar, context);
  if (!capture) throw new Error("thumbs:capture was not registered");
  return capture;
}

const valid = {
  projectPath: "/project",
  baseUrl: "http://127.0.0.1:4321",
  route: "/",
  viewport: { width: 768, height: 1024 },
  captureHeight: 576,
  mtimeMs: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSession.mockReturnValue({ previewUrl: valid.baseUrl });
  mocks.requireOpenSession.mockReturnValue("/project");
  mocks.captureThumbs.mockResolvedValue({ ok: true });
});

describe("thumbs:capture IPC", () => {
  it("passes a validated clean capture request to the main capture path", async () => {
    const result = await captureHandler()({}, valid);

    expect(result).toEqual({ ok: true });
    expect(mocks.captureThumbs).toHaveBeenCalledWith("/user-data", {
      projectPath: "/project",
      baseUrl: valid.baseUrl,
      route: "/",
      viewport: { width: 768, height: 1024 },
      captureHeight: 576,
      mtimeMs: 1,
    });
  });

  it("rejects a preview URL that does not belong to the open session", () => {
    expect(() =>
      captureHandler()(
        {},
        {
          ...valid,
          baseUrl: "http://127.0.0.1:9999",
        },
      ),
    ).toThrow("Preview URL does not match the open project session");
    expect(mocks.captureThumbs).not.toHaveBeenCalled();
  });

  it("rejects invalid or oversized capture viewports", () => {
    expect(() =>
      captureHandler()(
        {},
        {
          ...valid,
          captureHeight: 1025,
        },
      ),
    ).toThrow("Capture viewport is invalid");
    expect(() =>
      captureHandler()(
        {},
        {
          ...valid,
          viewport: { width: 4096, height: 4096 },
        },
      ),
    ).toThrow("Capture viewport is invalid");
    expect(mocks.captureThumbs).not.toHaveBeenCalled();
  });
});
