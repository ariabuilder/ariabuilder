import { type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { archiveEntry, checkSlugAvailable, createEntry, deleteCollectionEntries, deleteCollections, deleteEntry, duplicateEntry, getEntry, listEntries, listRevisions, publishEntry, restoreRevision, unpublishEntry, updateEntry } from "../services";
import { seedBlogCms } from "../seed";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

export function registerCmsEntriesIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "cms:list_entries",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        params: {
          collectionId: string;
          status?: import("../../../shared/cms").EntryStatus | import("../../../shared/cms").EntryStatus[];
          query?: string;
          page?: number;
          limit?: number;
          sort?: import("../../../shared/cms").EntrySort[];
          locale?: string;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!params || typeof params !== "object") {
          throw new Error("List params are required");
        }
        return listEntries(requireOpenSession(projectPath), params);
      },
    );

  handle(
      "cms:get_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryIdOrSlug: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryIdOrSlug !== "string" || !entryIdOrSlug.trim()) {
          throw new Error("Entry id or slug is required");
        }
        return getEntry(
          requireOpenSession(projectPath),
          collectionId,
          entryIdOrSlug,
        );
      },
    );

  handle(
      "cms:create_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          collectionId: string;
          title?: string;
          slug?: string;
          locale?: string;
          frontmatter?: Record<string, unknown>;
          body?: unknown;
          status?: import("../../../shared/cms").EntryStatus;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Create input is required");
        }
        return createEntry(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "cms:update_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          collectionId: string;
          id: string;
          version: string;
          patch: {
            title?: string;
            slug?: string;
            frontmatter?: Record<string, unknown>;
            body?: unknown;
            locale?: string;
            status?: import("../../../shared/cms").EntryStatus;
            relations?: import("../../../shared/cms").AriaEntryRelation[];
            upsertLocale?: {
              locale: string;
              title?: string;
              slug?: string;
              frontmatter?: Record<string, unknown>;
              body?: unknown;
              isSource?: boolean;
              status?: import("../../../shared/cms").EntryStatus;
              publishedAt?: string | null;
            };
            locales?: import("../../../shared/cms").AriaEntryRecord["locales"];
          };
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (!input || typeof input !== "object") {
          throw new Error("Update input is required");
        }
        return updateEntry(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "cms:delete_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryId: string,
        version: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (typeof version !== "string" || !version.trim()) {
          throw new Error("Entry version is required");
        }
        deleteEntry(requireOpenSession(projectPath), collectionId, entryId, version);
        return { ok: true as const };
      },
    );

  handle(
      "cms:delete_collection_entries",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        const deleted = deleteCollectionEntries(
          requireOpenSession(projectPath),
          collectionId,
        );
        return { ok: true as const, deleted };
      },
    );

  handle(
      "cms:delete_collections",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionIds: unknown,
        expectedRevision: string,
        options?: { deleteEntries?: boolean },
      ) => {
        if (!Array.isArray(collectionIds) || collectionIds.length === 0 || collectionIds.length > 50) {
          throw new Error("Choose between 1 and 50 collections to delete");
        }
        const ids = collectionIds.filter(
          (id): id is string => typeof id === "string" && id.trim().length > 0,
        );
        if (ids.length !== collectionIds.length) throw new Error("Collection ids are invalid");
        if (typeof expectedRevision !== "string" || !expectedRevision.trim()) {
          throw new Error("Collection revision is required");
        }
        if (
          options !== undefined &&
          (!options ||
            typeof options !== "object" ||
            Object.keys(options).some((key) => key !== "deleteEntries") ||
            (options.deleteEntries !== undefined &&
              typeof options.deleteEntries !== "boolean"))
        ) {
          throw new Error("Invalid collection deletion options");
        }
        return deleteCollections(
          requireOpenSession(projectPath),
          ids,
          expectedRevision,
          options,
        );
      },
    );

  handle(
      "cms:duplicate_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryId: string,
        version: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (typeof version !== "string" || !version.trim()) {
          throw new Error("Entry version is required");
        }
        return duplicateEntry(
          requireOpenSession(projectPath),
          collectionId,
          entryId,
          version,
        );
      },
    );

  handle(
      "cms:publish_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryId: string,
        opts: { version: string },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (!opts || typeof opts.version !== "string" || !opts.version.trim()) {
          throw new Error("Entry version is required");
        }
        return publishEntry(
          requireOpenSession(projectPath),
          collectionId,
          entryId,
          opts,
        );
      },
    );

  handle(
      "cms:unpublish_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryId: string,
        opts: { version: string },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (!opts || typeof opts.version !== "string" || !opts.version.trim()) {
          throw new Error("Entry version is required");
        }
        return unpublishEntry(
          requireOpenSession(projectPath),
          collectionId,
          entryId,
          opts,
        );
      },
    );

  handle(
      "cms:archive_entry",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        entryId: string,
        opts: { version: string },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (!opts || typeof opts.version !== "string" || !opts.version.trim()) {
          throw new Error("Entry version is required");
        }
        return archiveEntry(
          requireOpenSession(projectPath),
          collectionId,
          entryId,
          opts,
        );
      },
    );

  handle(
      "cms:list_revisions",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        entryId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        return listRevisions(requireOpenSession(projectPath), entryId);
      },
    );

  handle(
      "cms:restore_revision",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        entryId: string,
        revisionId: string,
        version: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof entryId !== "string" || !entryId.trim()) {
          throw new Error("Entry id is required");
        }
        if (typeof revisionId !== "string" || !revisionId.trim()) {
          throw new Error("Revision id is required");
        }
        if (typeof version !== "string" || !version.trim()) {
          throw new Error("Entry version is required");
        }
        return restoreRevision(
          requireOpenSession(projectPath),
          entryId,
          revisionId,
          version,
        );
      },
    );

  handle(
      "cms:check_slug",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        slug: string,
        locale?: string,
        excludeEntryId?: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof slug !== "string" || !slug.trim()) {
          throw new Error("Slug is required");
        }
        return checkSlugAvailable(
          requireOpenSession(projectPath),
          collectionId,
          slug,
          locale,
          excludeEntryId,
        );
      },
    );

  handle(
      "cms:seed_blog",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return seedBlogCms(requireOpenSession(projectPath));
      },
    );
}
