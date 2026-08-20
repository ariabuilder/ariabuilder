import { afterEach, describe, expect, it, vi } from "vitest";
import type { WebContents } from "electron";
import {
  dispatchAgentRendererTool,
  disposeAgentRendererBridgeForWebContents,
  disposeAgentRendererBridgeForProject,
  getAgentRendererHostCapabilities,
  registerAgentRendererHost,
  resolveAgentRendererTool,
} from "./rendererToolBridge";

function fakeWebContents(id: number) {
  const send = vi.fn();
  return {
    value: {
      id,
      isDestroyed: () => false,
      send,
    } as unknown as WebContents,
    send,
  };
}

const WORKSPACE_REGISTRATION = "00000000-0000-4000-8000-000000000011";
const DOCUMENT_REGISTRATION = "00000000-0000-4000-8000-000000000012";

function registerHost(
  projectPath: string,
  webContents: WebContents,
  options: { document?: boolean } = { document: true },
) {
  registerAgentRendererHost({
    projectPath,
    webContents,
    scope: "workspace",
    registrationId: WORKSPACE_REGISTRATION,
    active: true,
  });
  if (options.document !== false) {
    registerAgentRendererHost({
      projectPath,
      webContents,
      scope: "document",
      registrationId: DOCUMENT_REGISTRATION,
      active: true,
    });
  }
}

afterEach(() => {
  disposeAgentRendererBridgeForWebContents(11);
  disposeAgentRendererBridgeForWebContents(12);
});

describe("renderer tool bridge ownership", () => {
  it("accepts only the owning renderer response", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value);

    const resultPromise = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: { nodes: [] },
    });
    const request = host.send.mock.calls[0]?.[1] as {
      requestId: string;
      projectPath: string;
    };

    expect(() =>
      resolveAgentRendererTool(12, {
        requestId: request.requestId,
        projectPath: request.projectPath,
        result: { ok: true, data: { inserted: 1 } },
      }),
    ).toThrow(/another project window/);

    resolveAgentRendererTool(11, {
      requestId: request.requestId,
      projectPath: request.projectPath,
      result: { ok: true, data: { inserted: 1 } },
    });
    await expect(resultPromise).resolves.toEqual({
      ok: true,
      data: { inserted: 1 },
    });
  });

  it("rejects a project that has no matching active host", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value);
    await expect(
      dispatchAgentRendererTool({
        projectPath: "/project/b",
        webContentsId: 11,
        toolName: "select_block",
        args: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_OPEN_DOCUMENT" },
    });
  });

  it("settles pending work when the renderer disappears", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value);
    const resultPromise = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    });
    disposeAgentRendererBridgeForWebContents(11);
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_OPEN_DOCUMENT" },
    });
  });

  it("settles pending work when the project closes", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value);
    const resultPromise = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    });
    disposeAgentRendererBridgeForProject("/project/a");
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_OPEN_DOCUMENT" },
    });
  });

  it("settles pending canvas work when the document lease closes", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value);
    const resultPromise = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    });

    registerAgentRendererHost({
      projectPath: "/project/a",
      webContents: host.value,
      scope: "document",
      registrationId: DOCUMENT_REGISTRATION,
      active: false,
    });

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      error: { code: "NO_OPEN_DOCUMENT" },
    });
  });

  it("keeps same-project hosts isolated by renderer window", async () => {
    const first = fakeWebContents(11);
    const second = fakeWebContents(12);
    registerHost("/project/a", first.value);
    registerHost("/project/a", second.value);

    const firstResult = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    });
    const secondResult = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 12,
      toolName: "insert_nodes",
      args: {},
    });

    expect(first.send).toHaveBeenCalledOnce();
    expect(second.send).toHaveBeenCalledOnce();
    const firstRequest = first.send.mock.calls[0]?.[1] as { requestId: string; projectPath: string };
    const secondRequest = second.send.mock.calls[0]?.[1] as { requestId: string; projectPath: string };
    resolveAgentRendererTool(11, {
      requestId: firstRequest.requestId,
      projectPath: firstRequest.projectPath,
      result: { ok: true, data: { window: 11 } },
    });
    resolveAgentRendererTool(12, {
      requestId: secondRequest.requestId,
      projectPath: secondRequest.projectPath,
      result: { ok: true, data: { window: 12 } },
    });
    await expect(firstResult).resolves.toMatchObject({ ok: true, data: { window: 11 } });
    await expect(secondResult).resolves.toMatchObject({ ok: true, data: { window: 12 } });
  });

  it("does not let a stale document lease unregister the current document", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value, { document: false });
    const staleId = "00000000-0000-4000-8000-000000000021";
    const currentId = "00000000-0000-4000-8000-000000000022";
    registerAgentRendererHost({
      projectPath: "/project/a",
      webContents: host.value,
      scope: "document",
      registrationId: staleId,
      active: true,
    });
    registerAgentRendererHost({
      projectPath: "/project/a",
      webContents: host.value,
      scope: "document",
      registrationId: currentId,
      active: true,
    });
    registerAgentRendererHost({
      projectPath: "/project/a",
      webContents: host.value,
      scope: "document",
      registrationId: staleId,
      active: false,
    });

    expect(getAgentRendererHostCapabilities({
      projectPath: "/project/a",
      webContentsId: 11,
    })).toEqual({ navigation: true, document: true });
    const result = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    });
    const request = host.send.mock.calls[0]?.[1] as { requestId: string; projectPath: string };
    resolveAgentRendererTool(11, {
      requestId: request.requestId,
      projectPath: request.projectPath,
      result: { ok: true, data: { changed: true } },
    });
    await expect(result).resolves.toMatchObject({ ok: true });
  });

  it("allows navigation but rejects canvas mutation without a document lease", async () => {
    const host = fakeWebContents(11);
    registerHost("/project/a", host.value, { document: false });

    const navigation = dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "open_in_composer",
      args: { route: "/" },
    });
    const request = host.send.mock.calls[0]?.[1] as { requestId: string; projectPath: string };
    resolveAgentRendererTool(11, {
      requestId: request.requestId,
      projectPath: request.projectPath,
      result: { ok: true, data: { opened: true } },
    });
    await expect(navigation).resolves.toMatchObject({ ok: true });

    await expect(dispatchAgentRendererTool({
      projectPath: "/project/a",
      webContentsId: 11,
      toolName: "insert_nodes",
      args: {},
    })).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NO_OPEN_DOCUMENT",
        suggestedFix: expect.stringMatching(/Open the target document/),
      },
    });
  });
});
