import { type IpcMainInvokeEvent } from "../electron-api";
import { requireOpenSession } from "../sessions";
import { createStylesheet, deleteStylesheet, detectIconRuntime, detectFontsourceRuntime, resolveProjectIcons, searchProjectIcons, ensureDesignEntry, getDesignSnapshot, previewDesignTokenMutation, applyDesignTokenMutation, selectDesignTokenSource, listStylesheets, patchDesignSystem, readStylesheet, revealStylesheet, scanClassUsage, uploadDesignFont, revealDesignFont, deleteDesignFont, writeStylesheet } from "./";
import type { DesignIconSearchRequest, DesignPatch, DesignTokenMutationInput, DesignTokenSourceSelectionInput } from "../../shared/design";
import { renameClassAcrossProject } from "../agent/renameClassAcrossProject";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerDesignIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "design:get_snapshot",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return getDesignSnapshot(requireOpenSession(projectPath));
      },
    );

  handle(
      "design:preview_token_mutation",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: DesignTokenMutationInput,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Design token mutation is required");
        }
        return previewDesignTokenMutation(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "design:apply_token_mutation",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: DesignTokenMutationInput,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Design token mutation is required");
        }
        return applyDesignTokenMutation(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "design:select_token_source",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: DesignTokenSourceSelectionInput,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Design token source selection is required");
        }
        return selectDesignTokenSource(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "design:detect_icon_runtime",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return detectIconRuntime(requireOpenSession(projectPath));
      },
    );

  handle(
      "design:detect_fontsource_runtime",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return detectFontsourceRuntime(requireOpenSession(projectPath));
      },
    );

  handle(
      "design:search_icons",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        request: DesignIconSearchRequest,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return searchProjectIcons(requireOpenSession(projectPath), request);
      },
    );

  handle(
      "design:resolve_icons",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        ids: readonly string[],
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return resolveProjectIcons(requireOpenSession(projectPath), ids);
      },
    );

  handle(
      "design:patch",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        patch: DesignPatch,
        expectedRevision?: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!patch || typeof patch !== "object") {
          throw new Error("Design patch is required");
        }
        const root = requireOpenSession(projectPath);
        if (
          expectedRevision &&
          getDesignSnapshot(root).revision !== expectedRevision
        ) {
          throw new Error(
            "DESIGN_SOURCE_CONFLICT: The design system changed. Refresh and try again.",
          );
        }
        return patchDesignSystem(root, patch);
      },
    );

  handle(
      "design:ensure_entry",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return ensureDesignEntry(requireOpenSession(projectPath));
      },
    );

  handle(
      "design:list_stylesheets",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return listStylesheets(requireOpenSession(projectPath));
      },
    );

  handle(
      "design:scan_class_usage",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        classNames: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const names = Array.isArray(classNames)
          ? classNames.filter((n): n is string => typeof n === "string")
          : [];
        return scanClassUsage(requireOpenSession(projectPath), names);
      },
    );

  handle(
      "design:rename_class",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        from: string,
        to: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof from !== "string" || typeof to !== "string") {
          throw new Error("Class names are required");
        }
        const root = requireOpenSession(projectPath);
        const snapshot = getDesignSnapshot(root);
        return renameClassAcrossProject({
          projectPath: root,
          from,
          to,
          expectedRevision: snapshot.revision,
        });
      },
    );

  handle(
      "design:read_stylesheet",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativePath: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativePath !== "string" || !relativePath.trim()) {
          throw new Error("Stylesheet path is required");
        }
        return readStylesheet(requireOpenSession(projectPath), relativePath);
      },
    );

  handle(
      "design:write_stylesheet",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativePath: string,
        content: string,
        expectedMtimeMs?: number | null,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativePath !== "string" || !relativePath.trim()) {
          throw new Error("Stylesheet path is required");
        }
        if (typeof content !== "string") {
          throw new Error("Stylesheet content is required");
        }
        return writeStylesheet(
          requireOpenSession(projectPath),
          relativePath,
          content,
          expectedMtimeMs,
        );
      },
    );

  handle(
      "design:create_stylesheet",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        name: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof name !== "string" || !name.trim()) {
          throw new Error("Stylesheet name is required");
        }
        return createStylesheet(requireOpenSession(projectPath), name);
      },
    );

  handle(
      "design:delete_stylesheet",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativePath: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativePath !== "string" || !relativePath.trim()) {
          throw new Error("Stylesheet path is required");
        }
        return deleteStylesheet(requireOpenSession(projectPath), relativePath);
      },
    );

  handle(
      "design:reveal_stylesheet",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativePath: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativePath !== "string" || !relativePath.trim()) {
          throw new Error("Stylesheet path is required");
        }
        return revealStylesheet(requireOpenSession(projectPath), relativePath);
      },
    );

  handle(
      "design:upload_font",
      async (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        try {
          return await uploadDesignFont(
            context.senderWindow(event),
            requireOpenSession(projectPath),
          );
        } catch (error) {
          // Node fs SystemError and similar are not always IPC-cloneable.
          throw new Error(
            error instanceof Error ? error.message : "Failed to upload font",
          );
        }
      },
    );

  handle(
      "design:reveal_font",
      (_event: IpcMainInvokeEvent, projectPath: string, relativeFile: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Font path is required");
        }
        try {
          return revealDesignFont(requireOpenSession(projectPath), relativeFile);
        } catch (error) {
          throw new Error(
            error instanceof Error ? error.message : "Failed to reveal font",
          );
        }
      },
    );

  handle(
      "design:delete_font",
      (_event: IpcMainInvokeEvent, projectPath: string, relativeFile: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Font path is required");
        }
        try {
          return deleteDesignFont(requireOpenSession(projectPath), relativeFile);
        } catch (error) {
          throw new Error(
            error instanceof Error ? error.message : "Failed to delete font",
          );
        }
      },
    );
}
