import { type IpcMainInvokeEvent } from "../../electron-api";
import { requireOpenSession } from "../../sessions";
import { listWordPressImportBatches, listWordPressImportEvents, deleteWordPressImportBatch } from "../wordpressImport/batchStore";
import type { IpcRegistrar, IpcRuntimeContext } from "../../ipc/registrar";

function loadMarkdownImport() {
  return import("../markdownImport");
}

function loadMarkdownBatchImport() {
  return import("../markdownBatchImport");
}

function loadWordPressImport() {
  return import("../wordpressImport/service");
}

export function registerCmsImportsIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "cms:preview_markdown_import",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        markdown: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof markdown !== "string") {
          throw new Error("Markdown content is required");
        }
        const { previewImportMarkdown } = await loadMarkdownImport();
        return previewImportMarkdown(
          requireOpenSession(projectPath),
          collectionId,
          markdown,
        );
      },
    );

  handle(
      "cms:import_markdown",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        collectionId: string,
        markdown: string,
        opts?: {
          addMissingFields?: boolean;
          selectedFieldKeys?: string[];
          previewHash: string;
        },
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof collectionId !== "string" || !collectionId.trim()) {
          throw new Error("Collection id is required");
        }
        if (typeof markdown !== "string") {
          throw new Error("Markdown content is required");
        }
        const { importMarkdownToEntry } = await loadMarkdownImport();
        return importMarkdownToEntry(
          requireOpenSession(projectPath),
          collectionId,
          markdown,
          opts,
        );
      },
    );

  handle(
      "cms:wordpress_import_upload",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { filename: string; bytes: ArrayBuffer },
      ) => {
        const root = requireOpenSession(projectPath);
        if (!input || typeof input.filename !== "string") {
          throw new Error("WordPress import filename is required");
        }
        if (!(input.bytes instanceof ArrayBuffer)) {
          throw new Error("WordPress import bytes are required");
        }
        const {
          cleanupExpiredWordPressImportFiles,
          uploadAndAnalyzeWordPressImport,
        } = await loadWordPressImport();
        cleanupExpiredWordPressImportFiles(root);
        const result = await uploadAndAnalyzeWordPressImport({
          projectPath: root,
          filename: input.filename,
          bytes: new Uint8Array(input.bytes),
        });
        return { batch: result.batch };
      },
    );

  handle(
      "cms:wordpress_import_analyze",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string },
      ) => {
        const root = requireOpenSession(projectPath);
        const { reanalyzeWordPressImportBatch } = await loadWordPressImport();
        return reanalyzeWordPressImportBatch({
          projectPath: root,
          batchId: input.batchId,
        });
      },
    );

  handle(
      "cms:wordpress_import_apply",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string; scope: Record<string, boolean> },
      ) => {
        const root = requireOpenSession(projectPath);
        const {
          applyWordPressImportBatch,
          getWordPressImportBatchOrThrow,
        } = await loadWordPressImport();
        // Fire-and-progress: start apply; UI polls get_batch
        void applyWordPressImportBatch({
          projectPath: root,
          batchId: input.batchId,
          scope: input.scope,
        }).catch((error) => {
          console.error("[wordpress-import] apply failed", error);
        });
        return getWordPressImportBatchOrThrow(root, input.batchId);
      },
    );

  handle(
      "cms:wordpress_import_cancel",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string },
      ) => {
        const { cancelWordPressImportApply } = await loadWordPressImport();
        return cancelWordPressImportApply(
          requireOpenSession(projectPath),
          input.batchId,
        );
      },
    );

  handle(
      "cms:wordpress_import_get_batch",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string },
      ) => {
        const { getWordPressImportBatchOrThrow } = await loadWordPressImport();
        return getWordPressImportBatchOrThrow(
          requireOpenSession(projectPath),
          input.batchId,
        );
      },
    );

  handle(
      "cms:wordpress_import_get_events",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string; limit?: number },
      ) => {
        const events = listWordPressImportEvents(
          requireOpenSession(projectPath),
          input.batchId,
        );
        const limit =
          typeof input.limit === "number" && input.limit > 0 ? input.limit : 50;
        return events.slice(-limit);
      },
    );

  handle(
      "cms:wordpress_import_get_report",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string },
      ) => {
        const { getWordPressImportReport } = await loadWordPressImport();
        return getWordPressImportReport(
          requireOpenSession(projectPath),
          input.batchId,
        );
      },
    );

  handle(
      "cms:wordpress_import_list_batches",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input?: { limit?: number },
      ) => {
        const batches = listWordPressImportBatches(requireOpenSession(projectPath));
        const limit =
          typeof input?.limit === "number" && input.limit > 0
            ? input.limit
            : batches.length;
        return batches.slice(0, limit);
      },
    );

  handle(
      "cms:wordpress_import_delete_batch",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: { batchId: string },
      ) => {
        deleteWordPressImportBatch(requireOpenSession(projectPath), input.batchId);
        return { ok: true as const };
      },
    );

  handle(
      "cms:wordpress_import_cleanup_expired",
      async (_event: IpcMainInvokeEvent, projectPath: string) => {
        const { cleanupExpiredWordPressImportFiles } = await loadWordPressImport();
        return cleanupExpiredWordPressImportFiles(requireOpenSession(projectPath));
      },
    );

  handle(
      "cms:preview_markdown_import_batch",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          collectionId: string;
          files: Array<{ path: string; content: string }>;
          mode: "create" | "update";
          selectedFieldKeys?: string[];
        },
      ) => {
        const { previewMarkdownImportBatch } = await loadMarkdownBatchImport();
        return previewMarkdownImportBatch(requireOpenSession(projectPath), input);
      },
    );

  handle(
      "cms:import_markdown_batch",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: {
          collectionId: string;
          files: Array<{ path: string; content: string }>;
          mode: "create" | "update";
          selectedFieldKeys?: string[];
          addFields?: Array<{ key: string; type: string }>;
        },
      ) => {
        const { importMarkdownImportBatch } = await loadMarkdownBatchImport();
        return importMarkdownImportBatch(requireOpenSession(projectPath), input);
      },
    );
}
