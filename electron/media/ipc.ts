import { shell, type IpcMainInvokeEvent } from "../electron-api";
import { requireOpenSession } from "../sessions";
import { readMediaGrouping, writeMediaGrouping } from "../siteSettings";
import { deleteMedia, duplicateMedia, installMediaFiles, listMedia, listMediaUsages, pickMediaFiles, readMediaPreview, renameMedia, resolveMediaFilePath } from "../media";
import { getPlayableMediaUrl } from "../mediaProtocol";
import { deleteMediaVariant, getMediaTransformState, saveMediaProfile, saveMediaVariant, saveMediaVariantWithProfile } from "../mediaTransforms";
import { runProjectMutation } from "../mutations";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerMediaIpc(
  registrar: IpcRegistrar,
  context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "media:list",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return listMedia(requireOpenSession(projectPath));
      },
    );

  handle(
      "media:usages",
      (_event: IpcMainInvokeEvent, projectPath: string, assetId: string) => {
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return listMediaUsages(requireOpenSession(projectPath), assetId.trim());
      },
    );

  handle(
      "media:upload",
      async (event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const selection = await pickMediaFiles(context.senderWindow(event));
        if ("canceled" in selection) return selection;
        return runProjectMutation(
          root,
          { actor: "user", surface: "media", operation: "upload", targets: [] },
          () => installMediaFiles(root, selection.filePaths),
        );
      },
    );

  handle(
      "media:delete",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return deleteMedia(requireOpenSession(projectPath), assetId);
      },
    );

  handle(
      "media:rename",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
        nextName: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        if (typeof nextName !== "string" || !nextName.trim()) {
          throw new Error("New name is required");
        }
        return renameMedia(
          requireOpenSession(projectPath),
          assetId,
          nextName,
        );
      },
    );

  handle(
      "media:duplicate",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return duplicateMedia(requireOpenSession(projectPath), assetId);
      },
    );

  handle(
      "media:reveal",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        const absolute = resolveMediaFilePath(
          requireOpenSession(projectPath),
          assetId,
        );
        shell.showItemInFolder(absolute);
        return { path: absolute };
      },
    );

  handle(
      "media:resolve",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return {
          path: resolveMediaFilePath(requireOpenSession(projectPath), assetId),
        };
      },
    );

  handle(
      "media:preview",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return readMediaPreview(requireOpenSession(projectPath), assetId);
      },
    );

  handle(
      "media:get_playable_url",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return getPlayableMediaUrl(projectPath, assetId);
      },
    );

  handle(
      "media:get_grouping",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return readMediaGrouping(requireOpenSession(projectPath));
      },
    );

  handle(
      "media:update_grouping",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        grouping: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return writeMediaGrouping(requireOpenSession(projectPath), grouping);
      },
    );

  handle(
      "media:get_transform_state",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        return getMediaTransformState(requireOpenSession(projectPath), assetId);
      },
    );

  handle(
      "media:save_profile",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Profile input is required");
        }
        return saveMediaProfile(
          requireOpenSession(projectPath),
          input as Parameters<typeof saveMediaProfile>[1],
        );
      },
    );

  handle(
      "media:save_variant",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Variant input is required");
        }
        const raw = input as Record<string, unknown>;
        const bytesRaw = raw.bytes;
        let bytes: Uint8Array;
        if (bytesRaw instanceof Uint8Array) {
          bytes = bytesRaw;
        } else if (bytesRaw instanceof ArrayBuffer) {
          bytes = new Uint8Array(bytesRaw);
        } else if (
          bytesRaw &&
          typeof bytesRaw === "object" &&
          ArrayBuffer.isView(bytesRaw)
        ) {
          const view = bytesRaw as ArrayBufferView;
          bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        } else {
          throw new Error("Variant bytes are required");
        }
        if (bytes.byteLength > 40 * 1024 * 1024) {
          throw new Error("Variant payload exceeds the 40 MB limit");
        }
        return saveMediaVariant(requireOpenSession(projectPath), {
          ...(raw as Parameters<typeof saveMediaVariant>[1]),
          bytes,
        });
      },
    );

  handle(
      "media:save_variant_with_profile",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Variant and profile input is required");
        }
        const raw = input as { variant?: Record<string, unknown>; profile?: unknown };
        if (!raw.variant || !raw.profile || typeof raw.profile !== "object") {
          throw new Error("Variant and profile input is required");
        }
        const bytesRaw = raw.variant.bytes;
        let bytes: Uint8Array;
        if (bytesRaw instanceof Uint8Array) {
          bytes = bytesRaw;
        } else if (bytesRaw instanceof ArrayBuffer) {
          bytes = new Uint8Array(bytesRaw);
        } else if (bytesRaw && typeof bytesRaw === "object" && ArrayBuffer.isView(bytesRaw)) {
          const view = bytesRaw as ArrayBufferView;
          bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
        } else {
          throw new Error("Variant bytes are required");
        }
        if (bytes.byteLength > 40 * 1024 * 1024) {
          throw new Error("Variant payload exceeds the 40 MB limit");
        }
        return saveMediaVariantWithProfile(requireOpenSession(projectPath), {
          variant: {
            ...(raw.variant as Parameters<typeof saveMediaVariant>[1]),
            bytes,
          },
          profile: raw.profile as Parameters<typeof saveMediaProfile>[1],
        });
      },
    );

  handle(
      "media:delete_variant",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        assetId: string,
        variantId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof assetId !== "string" || !assetId.trim()) {
          throw new Error("Media id is required");
        }
        if (typeof variantId !== "string" || !variantId.trim()) {
          throw new Error("Variant id is required");
        }
        return deleteMediaVariant(
          requireOpenSession(projectPath),
          assetId,
          variantId,
        );
      },
    );
}
