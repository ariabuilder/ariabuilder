import { type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { assessCollectionMigration, getExternalEntry, listExternalEntries, migrateCollectionToAria, readCollectionRegistryWithCache } from "../../collectionRegistry";
import { cancelCollectionRefresh, refreshCollectionSource } from "../../collectionRefresh";
import { writeCollectionsWithContentConfig } from "../../cms";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerCollectionsIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "workspace:get_collections",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return readCollectionRegistryWithCache(requireOpenSession(projectPath));
      },
    );

  handle(
      "workspace:refresh_collection_source",
      (_event: IpcMainInvokeEvent, projectPath: string, collectionId: string) => {
        if (typeof collectionId !== "string" || !collectionId.trim()) throw new Error("Collection id is required");
        return refreshCollectionSource(requireOpenSession(projectPath), collectionId);
      },
    );

  handle(
      "workspace:list_external_entries",
      (_event: IpcMainInvokeEvent, projectPath: string, input: Parameters<typeof listExternalEntries>[1]) => {
        if (!input || typeof input !== "object") throw new Error("External entry query is required");
        return listExternalEntries(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "workspace:get_external_entry",
      (_event: IpcMainInvokeEvent, projectPath: string, collectionId: string, entryId: string) => {
        if (typeof collectionId !== "string" || typeof entryId !== "string") {
          throw new Error("Collection and entry ids are required");
        }
        return getExternalEntry(requireOpenSession(projectPath), collectionId, entryId);
      },
    );

  handle(
      "workspace:assess_collection_migration",
      (_event: IpcMainInvokeEvent, projectPath: string, collectionId: string) => {
        if (typeof collectionId !== "string" || !collectionId.trim()) throw new Error("Collection id is required");
        return assessCollectionMigration(requireOpenSession(projectPath), collectionId);
      },
    );

  handle(
      "cms:migrate_collection",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        previewHash: string,
      ) => {
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof previewHash !== "string" || !previewHash.trim()) {
          throw new Error("Migration preview is required");
        }
        return migrateCollectionToAria(
          requireOpenSession(projectPath),
          collectionId,
          previewHash,
        );
      },
    );

  handle(
      "workspace:cancel_collection_refresh",
      (_event: IpcMainInvokeEvent, projectPath: string, collectionId: string) => {
        if (typeof collectionId !== "string" || !collectionId.trim()) return false;
        return cancelCollectionRefresh(requireOpenSession(projectPath), collectionId);
      },
    );

  handle(
      "workspace:update_collections",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collections: unknown,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(projectPath);
        const next = writeCollectionsWithContentConfig(root, collections);
        return next;
      },
    );
}
