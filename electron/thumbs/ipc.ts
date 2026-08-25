import { type IpcMainInvokeEvent } from "../electron-api";
import { getSession, requireOpenSession } from "../sessions";
import {
  cancelWarmPageThumbs,
  captureThumbs,
  getComponentThumb,
  getLayoutThumb,
  getPageThumb,
  getProjectThumb,
  prioritizeComponentThumbs,
  warmComponentThumbs,
  warmLayoutThumbs,
  warmPageThumbs,
  type CaptureViewport,
} from "../thumbs";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerThumbsIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
    "thumbs:capture",
    (
      _event: IpcMainInvokeEvent,
      opts: {
        projectPath?: string;
        baseUrl?: string;
        route?: string;
        viewport?: CaptureViewport;
        captureHeight?: number;
        mtimeMs?: number | null;
      },
    ) => {
      if (
        !opts ||
        typeof opts.projectPath !== "string" ||
        !opts.projectPath.trim()
      ) {
        throw new Error("Project path is required");
      }
      if (typeof opts.baseUrl !== "string" || !opts.baseUrl.trim()) {
        throw new Error("Preview URL is required");
      }
      if (!opts.viewport || typeof opts.viewport !== "object") {
        throw new Error("Capture viewport is required");
      }
      const { width, height } = opts.viewport;
      const captureHeight = opts.captureHeight;
      if (
        typeof width !== "number" ||
        !Number.isFinite(width) ||
        typeof height !== "number" ||
        !Number.isFinite(height) ||
        typeof captureHeight !== "number" ||
        !Number.isFinite(captureHeight) ||
        width <= 0 ||
        height <= 0 ||
        captureHeight <= 0 ||
        width > 4096 ||
        height > 4096 ||
        width * height > 12_000_000 ||
        captureHeight > height
      ) {
        throw new Error("Capture viewport is invalid");
      }
      const root = requireOpenSession(opts.projectPath);
      const session = getSession(root);
      if (!session?.previewUrl || opts.baseUrl !== session.previewUrl) {
        throw new Error("Preview URL does not match the open project session");
      }
      return captureThumbs(context.userDataPath, {
        projectPath: root,
        baseUrl: opts.baseUrl,
        route: typeof opts.route === "string" ? opts.route : "/",
        viewport: { width, height },
        captureHeight,
        mtimeMs: opts.mtimeMs,
      });
    },
  );

  handle(
      "thumbs:getPage",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          route?: string;
          mtimeMs?: number | null;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(opts.projectPath);
        return getPageThumb(
          context.userDataPath,
          root,
          typeof opts.route === "string" ? opts.route : "/",
          opts.mtimeMs,
        );
      },
    );

  handle(
      "thumbs:getComponent",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          id?: string;
          mtimeMs?: number | null;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof opts.id !== "string" || !opts.id.trim()) {
          throw new Error("Component id is required");
        }
        const root = requireOpenSession(opts.projectPath);
        return getComponentThumb(
          context.userDataPath,
          root,
          opts.id,
          opts.mtimeMs,
        );
      },
    );

  handle(
      "thumbs:getLayout",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          id?: string;
          mtimeMs?: number | null;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof opts.id !== "string" || !opts.id.trim()) {
          throw new Error("Layout id is required");
        }
        const root = requireOpenSession(opts.projectPath);
        return getLayoutThumb(
          context.userDataPath,
          root,
          opts.id,
          opts.mtimeMs,
        );
      },
    );

  handle(
      "thumbs:getProject",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return getProjectThumb(
          context.userDataPath,
          // Welcome reads cached project thumbnails before a project session is
          // opened. This lookup only derives an Aria-owned cache path from the
          // project identifier; it does not read from the project itself.
          projectPath.trim(),
        );
      },
    );

  handle(
      "thumbs:warmPages",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          baseUrl?: string;
          pages?: Array<{ route?: string; mtimeMs?: number | null }>;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof opts.baseUrl !== "string" || !opts.baseUrl.trim()) {
          throw new Error("Preview URL is required");
        }
        if (!Array.isArray(opts.pages)) {
          throw new Error("Pages list is required");
        }
        if (opts.pages.length > 100) {
          throw new Error("No more than 100 pages can be warmed at once");
        }
        const root = requireOpenSession(opts.projectPath);
        const session = getSession(root);
        if (!session?.previewUrl || opts.baseUrl !== session.previewUrl) {
          throw new Error("Preview URL does not match the open project session");
        }
        const pages = opts.pages
          .filter((p) => p && typeof p.route === "string")
          .map((p) => ({
            route: p.route as string,
            mtimeMs: p.mtimeMs,
          }));
        // Fire-and-forget from the caller's perspective would block IPC for
        // minutes — run the warm job without awaiting full completion here.
        // Returning the promise still lets invoke resolve when done; renderer
        // should not await it. We return immediately via void pattern below.
        void warmPageThumbs(context.userDataPath, {
          projectPath: root,
          baseUrl: opts.baseUrl,
          pages,
        });
        return { ok: true as const };
      },
    );

  handle(
      "thumbs:warmComponents",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          baseUrl?: string;
          components?: Array<{ id?: string; mtimeMs?: number | null }>;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof opts.baseUrl !== "string" || !opts.baseUrl.trim()) {
          throw new Error("Preview URL is required");
        }
        if (!Array.isArray(opts.components)) {
          throw new Error("Components list is required");
        }
        if (opts.components.length > 100) {
          throw new Error("No more than 100 components can be warmed at once");
        }
        const root = requireOpenSession(opts.projectPath);
        const session = getSession(root);
        if (!session?.previewUrl || opts.baseUrl !== session.previewUrl) {
          throw new Error("Preview URL does not match the open project session");
        }
        const components = opts.components
          .filter((c) => c && typeof c.id === "string" && c.id.trim())
          .map((c) => ({
            id: c.id as string,
            mtimeMs: c.mtimeMs,
          }));
        void warmComponentThumbs(context.userDataPath, {
          projectPath: root,
          baseUrl: opts.baseUrl,
          components,
        });
        return { ok: true as const };
      },
    );

  handle(
      "thumbs:prioritizeComponents",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          ids?: string[];
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!Array.isArray(opts.ids)) {
          throw new Error("Component ids are required");
        }
        if (opts.ids.length > 100) {
          throw new Error("No more than 100 components can be prioritized at once");
        }
        const root = requireOpenSession(opts.projectPath);
        const ids = opts.ids.filter((id) => typeof id === "string" && id.trim());
        return prioritizeComponentThumbs(root, ids);
      },
    );

  handle(
      "thumbs:warmLayouts",
      (
        _event: IpcMainInvokeEvent,
        opts: {
          projectPath?: string;
          baseUrl?: string;
          pages?: Array<{ route?: string; mtimeMs?: number | null }>;
          layouts?: Array<{ id?: string; mtimeMs?: number | null }>;
        },
      ) => {
        if (!opts || typeof opts.projectPath !== "string" || !opts.projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof opts.baseUrl !== "string" || !opts.baseUrl.trim()) {
          throw new Error("Preview URL is required");
        }
        if (!Array.isArray(opts.pages) || !Array.isArray(opts.layouts)) {
          throw new Error("Pages and layouts lists are required");
        }
        if (opts.pages.length > 100 || opts.layouts.length > 100) {
          throw new Error("No more than 100 pages or layouts can be warmed at once");
        }
        const root = requireOpenSession(opts.projectPath);
        const session = getSession(root);
        if (!session?.previewUrl || opts.baseUrl !== session.previewUrl) {
          throw new Error("Preview URL does not match the open project session");
        }
        const pages = opts.pages
          .filter((page) => page && typeof page.route === "string")
          .map((page) => ({ route: page.route as string, mtimeMs: page.mtimeMs }));
        const layouts = opts.layouts
          .filter((layout) => layout && typeof layout.id === "string" && layout.id.trim())
          .map((layout) => ({ id: layout.id as string, mtimeMs: layout.mtimeMs }));
        void warmLayoutThumbs(context.userDataPath, {
          projectPath: root,
          baseUrl: opts.baseUrl,
          pages,
          layouts,
        });
        return { ok: true as const };
      },
    );

  handle("thumbs:cancelWarm", () => {
      cancelWarmPageThumbs();
      return { ok: true as const };
    }, { duringShutdown: true });
}
