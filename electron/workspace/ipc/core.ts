import { shell, type IpcMainInvokeEvent } from "../../electron-api";
import { getSession, requireOpenSession } from "../../sessions";
import { waitForPreviewRoute } from "../../astroRuntime";
import { readComponentGrouping, readSiteSettings, writeComponentGrouping } from "../../siteSettings";
import { readPagesMeta, writePagesMeta } from "../../pagesMeta";
import { syncManagedSeoAndDiscovery } from "../../seoSync";
import { regenerateContentConfig, writeCollectionsWithContentConfig } from "../../cms";
import { createComponent, createLayout, createPage, deleteComponent, deleteComponentFolder, deletePage, renameComponentFolder, resolveComponentFilePath, resolvePageFilePath, scanProject } from "../../workspace";
import { buildLayoutPreviewInventory } from "../../layoutPreview";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerWorkspaceIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "workspace:scan",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return scanProject(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:inspect_layouts",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return buildLayoutPreviewInventory(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:create_page",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        name: string,
        options?: import("../../../shared/types").CreatePageOptions,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof name !== "string" || !name.trim()) {
          throw new Error("Page name is required");
        }
        const root = requireOpenSession(projectPath);
        const created = createPage(root, name, options);
        // Vite needs a beat to register the new file. Navigating immediately
        // loads Astro's 404 into the iframe and sticks there.
        const session = getSession(root);
        if (session?.live && session.previewUrl) {
          await waitForPreviewRoute(session.previewUrl, created.route);
        }
        return created;
      },
    );

  handle(
      "workspace:delete_page",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        options?: { unassignCms?: boolean },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        if (
          options !== undefined &&
          (!options ||
            typeof options !== "object" ||
            Object.keys(options).some((key) => key !== "unassignCms") ||
            (options.unassignCms !== undefined &&
              typeof options.unassignCms !== "boolean"))
        ) {
          throw new Error("Invalid page deletion options");
        }
        const root = requireOpenSession(projectPath);
        const result = deletePage(root, relativeFile, options);
        if (options?.unassignCms) regenerateContentConfig(root);
        return result;
      },
    );

  handle(
      "workspace:reveal_page",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        const absolute = resolvePageFilePath(requireOpenSession(projectPath), relativeFile);
        shell.showItemInFolder(absolute);
        return { path: absolute };
      },
    );

  handle(
      "workspace:resolve_page",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        return { path: resolvePageFilePath(requireOpenSession(projectPath), relativeFile) };
      },
    );

  handle(
      "workspace:create_component",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        name: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof name !== "string" || !name.trim()) {
          throw new Error("Component name is required");
        }
        return createComponent(requireOpenSession(projectPath), name);
      },
    );

  handle(
      "workspace:create_layout",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        name: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof name !== "string" || !name.trim()) {
          throw new Error("Layout name is required");
        }
        return createLayout(requireOpenSession(projectPath), name);
      },
    );

  handle(
      "workspace:delete_component",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Component file is required");
        }
        return deleteComponent(requireOpenSession(projectPath), relativeFile);
      },
    );

  handle(
      "workspace:rename_component_folder",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        folderRel: string,
        nextNameOrPath: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof folderRel !== "string" || !folderRel.trim()) {
          throw new Error("Folder path is required");
        }
        if (typeof nextNameOrPath !== "string" || !nextNameOrPath.trim()) {
          throw new Error("New folder name is required");
        }
        return renameComponentFolder(
          requireOpenSession(projectPath),
          folderRel,
          nextNameOrPath,
        );
      },
    );

  handle(
      "workspace:delete_component_folder",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        folderRel: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof folderRel !== "string" || !folderRel.trim()) {
          throw new Error("Folder path is required");
        }
        return deleteComponentFolder(requireOpenSession(projectPath), folderRel);
      },
    );

  handle(
      "workspace:reveal_component",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Component file is required");
        }
        const absolute = resolveComponentFilePath(
          requireOpenSession(projectPath),
          relativeFile,
        );
        shell.showItemInFolder(absolute);
        return { path: absolute };
      },
    );

  handle(
      "workspace:resolve_component",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Component file is required");
        }
        return {
          path: resolveComponentFilePath(
            requireOpenSession(projectPath),
            relativeFile,
          ),
        };
      },
    );

  handle(
      "workspace:get_component_grouping",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return readComponentGrouping(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:update_component_grouping",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        grouping: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return writeComponentGrouping(requireOpenSession(projectPath), grouping);
      },
    );

  handle(
      "workspace:get_pages_meta",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return readPagesMeta(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:update_pages_meta",
      (_event: IpcMainInvokeEvent, projectPath: string, meta: unknown) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const result = writePagesMeta(root, meta);
        try {
          const settings = readSiteSettings(root);
          syncManagedSeoAndDiscovery(root, settings);
        } catch {
          // SEO sync is best-effort after page meta writes.
        }
        return result;
      },
    );

  handle(
      "workspace:update_page_config",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { pagesMeta?: unknown; collections?: unknown },
      ) => {
        if (!input || typeof input !== "object") {
          throw new Error("Page configuration is required");
        }
        const root = requireOpenSession(projectPath);
        const collections = writeCollectionsWithContentConfig(root, input.collections);
        const meta = writePagesMeta(root, input.pagesMeta);
        const settings = readSiteSettings(root);
        syncManagedSeoAndDiscovery(root, settings);
        return { meta, collections };
      },
    );
}
