import path from "node:path";
import { shell, type IpcMainInvokeEvent } from "../electron-api";
import { requireOpenSession } from "../sessions";
import { readCollections } from "../collections";
import { getEntry } from "../cms";
import { analyzeComposerSource, applyProjectTranslationCutover, applyProjectDataCutover, assessProjectTranslationAdoption, assessProjectDataAdoption, clearComposerPreviewDraft, completeComposerCode, commitComposerEditTransaction, extractComposerPropSchema, detectComposerFrameworks, createProjectDataDraft, createProjectTranslationDrafts, editComposerProjectData, editProjectDataCatalogValue, editProjectTranslationValue, inspectComposerProjectData, listProjectData, listProjectTranslationCatalogs, parseComposerPage, prepareComponentAuthoringPreview, setComposerPreviewDraft, writeComposerPage, writeComposerComponentControlMetadata } from "./";
import { runProjectMutation } from "../mutations";
import { canonicalDirectory, resolveWithinRoot } from "../pathSafety";
import type { IpcRegistrar, IpcRuntimeContext } from "../ipc/registrar";

export function registerComposerIpc(
  registrar: IpcRegistrar,
  _context: IpcRuntimeContext,
): void {
  const { handle } = registrar;
  handle(
      "composer:parse_page",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        collectionProps?: Record<string, import("../../shared/composer").AstroCollectionBinding>,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        const root = requireOpenSession(projectPath);
        return parseComposerPage({
          projectPath: root,
          relativeFile: relativeFile.trim(),
          collectionProps,
        });
      },
    );

  handle(
      "composer:analyze_source",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        source: string,
        collectionProps?: Record<string, import("../../shared/composer").AstroCollectionBinding>,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        if (typeof source !== "string") {
          throw new Error("Astro source is required");
        }
        const root = requireOpenSession(projectPath);
        return analyzeComposerSource({
          projectPath: root,
          relativeFile: relativeFile.trim(),
          source,
          collectionProps,
        });
      },
    );

  handle(
      "composer:set_preview_draft",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        source: string,
        leaseId: string,
        revision?: number,
      ) => {
        const root = requireOpenSession(projectPath);
        return setComposerPreviewDraft({
          projectPath: root,
          relativeFile,
          source,
          leaseId,
          revision,
        });
      },
    );

  handle(
      "composer:clear_preview_draft",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        leaseId: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return clearComposerPreviewDraft({
          // Cleanup is intentionally valid after the project session closes.
          // The operation only removes the hashed app-local draft owned by this
          // lease; it never writes into the project.
          projectPath: canonicalDirectory(projectPath),
          leaseId,
        });
      },
    );

  handle(
      "composer:inspect_project_data",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ComposerDataInspectionInput,
      ) => inspectComposerProjectData(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:list_project_data",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectDataCatalogInput,
      ) => listProjectData(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:edit_project_data_catalog_value",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectDataCatalogEditInput,
      ) => {
        const root = requireOpenSession(projectPath);
        return runProjectMutation(
          root,
          { actor: "user", surface: "composer", operation: "edit project data catalog value", targets: [input.sourceFile] },
          () => editProjectDataCatalogValue(root, input),
        );
      },
    );

  handle(
      "composer:list_translation_catalogs",
      (_event: IpcMainInvokeEvent, projectPath: string, refresh?: boolean) =>
        listProjectTranslationCatalogs(requireOpenSession(projectPath), Boolean(refresh)),
    );

  handle(
      "composer:edit_translation_value",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectTranslationEditInput,
      ) => editProjectTranslationValue(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:assess_translation_adoption",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectTranslationAdoptionInput,
      ) => assessProjectTranslationAdoption(requireOpenSession(projectPath), input),
    );

  handle(
      "cms:create_translation_drafts",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectTranslationAdoptionInput & { expectedPreviewHash: string },
      ) => createProjectTranslationDrafts(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:apply_translation_cutover",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectTranslationCutoverInput,
      ) => applyProjectTranslationCutover(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:assess_project_data_adoption",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectDataAdoptionInput,
      ) => assessProjectDataAdoption(requireOpenSession(projectPath), input),
    );

  handle(
      "composer:edit_project_data",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ComposerProjectDataEditInput,
      ) => {
        const root = requireOpenSession(projectPath);
        return runProjectMutation(
          root,
          { actor: "user", surface: "composer", operation: "edit project data", targets: [] },
          () => editComposerProjectData(root, input),
        );
      },
    );

  handle(
      "composer:create_project_data_draft",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectDataAdoptionInput,
      ) => {
        const root = requireOpenSession(projectPath);
        return runProjectMutation(
          root,
          { actor: "user", surface: "cms", operation: "adopt project data as draft", targets: [] },
          () => createProjectDataDraft(root, input),
        );
      },
    );

  handle(
      "composer:apply_project_data_cutover",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        input: import("../../shared/composer").ProjectDataCutoverInput,
      ) => {
        const root = requireOpenSession(projectPath);
        return runProjectMutation(
          root,
          { actor: "user", surface: "composer", operation: "cut over project data consumers", targets: [] },
          async () => {
            const collection = readCollections(root).collections.find((item) => item.id === input.collectionId);
            if (!collection) throw new Error("NOT_FOUND: The adopted CMS collection no longer exists.");
            const assessment = await assessProjectDataAdoption(root, input);
            if (collection.name !== assessment.collectionName) {
              throw new Error("PROJECT_DATA_CONFLICT: The selected CMS collection does not match this adoption review.");
            }
            const entry = getEntry(root, input.collectionId, input.entrySlug ?? "");
            if (!entry) throw new Error("NOT_FOUND: The adopted CMS draft no longer exists.");
            return applyProjectDataCutover(root, input);
          },
        );
      },
    );

  handle(
      "composer:reveal_project_data",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
      ) => {
        const root = requireOpenSession(projectPath);
        const absolute = resolveWithinRoot(root, path.join(root, relativeFile), { rejectFinalSymlink: true });
        shell.showItemInFolder(absolute);
        return { path: absolute };
      },
    );

  handle(
      "composer:complete_code",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        source: string,
        position: import("../../shared/composer").ComposerCodePosition,
      ) => completeComposerCode({
        projectPath: requireOpenSession(projectPath),
        relativeFile,
        source,
        position,
      }),
    );

  handle(
      "composer:write_page",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        model: unknown,
        expectedMtimeMs?: number | null,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof relativeFile !== "string" || !relativeFile.trim()) {
          throw new Error("Page file is required");
        }
        if (!model || typeof model !== "object") {
          throw new Error("Composer model is required");
        }
        const root = requireOpenSession(projectPath);
        return writeComposerPage({
          projectPath: root,
          relativeFile: relativeFile.trim(),
          model: model as import("../../shared/composer").AstroDocumentModel,
          expectedMtimeMs,
        });
      },
    );

  handle(
      "composer:commit_transaction",
      (
        _event: IpcMainInvokeEvent,
        transaction: import("../../shared/composer").ComposerEditTransaction,
      ) => {
        if (!transaction || typeof transaction !== "object") {
          throw new Error("Composer transaction is required");
        }
        if (
          typeof transaction.projectPath !== "string" ||
          !transaction.projectPath.trim()
        ) {
          throw new Error("Project path is required");
        }
        const root = requireOpenSession(transaction.projectPath);
        return commitComposerEditTransaction({
          ...transaction,
          projectPath: root,
        });
      },
    );

  handle(
      "composer:extract_prop_schema",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        fromRelativeFile: string,
        importSpec: string,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof fromRelativeFile !== "string" || !fromRelativeFile.trim()) {
          throw new Error("Source file is required");
        }
        if (typeof importSpec !== "string" || !importSpec.trim()) {
          throw new Error("Import specifier is required");
        }
        const root = requireOpenSession(projectPath);
        return extractComposerPropSchema({
          projectPath: root,
          fromRelativeFile: fromRelativeFile.trim(),
          importSpec: importSpec.trim(),
        });
      },
    );

  handle(
      "composer:write_component_control_metadata",
      async (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        relativeFile: string,
        metadata: import("../../shared/conditions").ComponentControlMetadata,
        expectedMtimeMs?: number | null,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) throw new Error("Project path is required");
        if (typeof relativeFile !== "string" || !relativeFile.trim()) throw new Error("Component file is required");
        return writeComposerComponentControlMetadata({
          projectPath: requireOpenSession(projectPath),
          relativeFile: relativeFile.trim(),
          metadata,
          expectedMtimeMs,
        });
      },
    );

  handle(
      "composer:detect_frameworks",
      (_event: IpcMainInvokeEvent, projectPath: string) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        return detectComposerFrameworks(requireOpenSession(projectPath));
      },
    );

  handle(
      "composer:prepare_component_preview",
      (
        _event: IpcMainInvokeEvent,
        projectPath: string,
        componentFile: string,
        override?: Partial<
          Pick<
            import("../../shared/composer").ComposerComponentPreviewData,
            "props" | "slots"
          >
        > | null,
      ) => {
        if (typeof projectPath !== "string" || !projectPath.trim()) {
          throw new Error("Project path is required");
        }
        if (typeof componentFile !== "string" || !componentFile.trim()) {
          throw new Error("Component file is required");
        }
        return prepareComponentAuthoringPreview(
          requireOpenSession(projectPath),
          componentFile,
          override,
        );
      },
    );
}
