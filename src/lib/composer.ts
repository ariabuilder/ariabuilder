import type { AstroCollectionBinding, AstroDocumentModel } from "../../shared/composer";
import type { ParseAstroBail, ParseAstroEditable } from "../../shared/composer";
import type { PropField } from "../../shared/composer";
import type {
  ComposerEditTransaction,
  ComposerEditTransactionResult,
} from "../../shared/composer";

function api() {
  if (!window.aria) {
    throw new Error(
      "Aria desktop bridge is unavailable. Restart the app with npm run dev.",
    );
  }
  if (!window.aria.composer) {
    throw new Error(
      "Composer API missing from preload. Stop the app and run npm run dev again.",
    );
  }
  return window.aria.composer;
}

/**
 * Electron IPC uses structured clone. Vue reactive Proxies are not cloneable —
 * strip to plain JSON before invoke.
 */
function toIpcPayload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function toCollectionPropsPayload(
  collectionProps?: Record<string, AstroCollectionBinding>,
): Record<string, AstroCollectionBinding> | undefined {
  return collectionProps === undefined ? undefined : toIpcPayload(collectionProps);
}

type ComposerParseMeta = { relativeFile: string; mtimeMs: number | null };
export type ComposerParsePageResult =
  | (ParseAstroEditable & ComposerParseMeta)
  | (ParseAstroBail & ComposerParseMeta);

export type ComposerWritePageResult = {
  ok: true;
  relativeFile: string;
  mtimeMs: number;
};

export type ComposerPropSchemaResult = {
  fields: PropField[];
  extendsTag: string | null;
  slots: string[];
  hasRest: boolean;
  relativeFile: string | null;
  resolved: boolean;
  mtimeMs: number | null;
  controlMetadataFound?: boolean;
  controlMetadataValid?: boolean;
  controlMetadataError?: string;
};

/** Parse the current route's `.astro` into the editable Composer model. */
export function parseComposerPage(
  projectPath: string,
  relativeFile: string,
  collectionProps?: Record<string, AstroCollectionBinding>,
): Promise<ComposerParsePageResult> {
  return api().parsePage(
    projectPath,
    relativeFile,
    toCollectionPropsPayload(collectionProps),
  );
}

/** Analyze an in-memory Code draft without writing it to disk. */
export function analyzeComposerSource(
  projectPath: string,
  relativeFile: string,
  source: string,
  collectionProps?: Record<string, AstroCollectionBinding>,
): Promise<import("../../shared/composer").ParseAstroResult> {
  return api().analyzeSource(
    projectPath,
    relativeFile,
    source,
    toCollectionPropsPayload(collectionProps),
  );
}

export function setComposerPreviewDraft(
  projectPath: string,
  relativeFile: string,
  source: string,
  leaseId: string,
  revision?: number,
) {
  return api().setPreviewDraft(projectPath, relativeFile, source, leaseId, revision);
}

export function clearComposerPreviewDraft(
  projectPath: string,
  leaseId: string,
) {
  return api().clearPreviewDraft(projectPath, leaseId);
}

export function completeComposerCode(
  projectPath: string,
  relativeFile: string,
  source: string,
  position: import("../../shared/composer").ComposerCodePosition,
) {
  return api().completeCode(projectPath, relativeFile, source, position);
}

export function listComposerTranslationCatalogs(projectPath: string, refresh = false) {
  return api().listTranslationCatalogs(projectPath, refresh);
}

export function editComposerTranslationValue(
  projectPath: string,
  input: import("../../shared/composer").ProjectTranslationEditInput,
) {
  return api().editTranslationValue(projectPath, JSON.parse(JSON.stringify(input)));
}

export function assessComposerTranslationAdoption(
  projectPath: string,
  input: import("../../shared/composer").ProjectTranslationAdoptionInput,
) {
  return api().assessTranslationAdoption(projectPath, JSON.parse(JSON.stringify(input)));
}

export function createComposerTranslationDrafts(
  projectPath: string,
  input: import("../../shared/composer").ProjectTranslationAdoptionInput & { expectedPreviewHash: string },
) {
  return api().createTranslationDrafts(projectPath, JSON.parse(JSON.stringify(input)));
}

export function applyComposerTranslationCutover(
  projectPath: string,
  input: import("../../shared/composer").ProjectTranslationCutoverInput,
) {
  return api().applyTranslationCutover(projectPath, JSON.parse(JSON.stringify(input)));
}

export function inspectComposerProjectData(
  projectPath: string,
  input: import("../../shared/composer").ComposerDataInspectionInput,
) {
  return api().inspectProjectData(projectPath, input);
}

export function listComposerProjectData(
  projectPath: string,
  input: import("../../shared/composer").ProjectDataCatalogInput,
) {
  return api().listProjectData(projectPath, JSON.parse(JSON.stringify(input)));
}

export function editComposerProjectDataCatalogValue(
  projectPath: string,
  input: import("../../shared/composer").ProjectDataCatalogEditInput,
) {
  return api().editProjectDataCatalogValue(projectPath, JSON.parse(JSON.stringify(input)));
}

export function assessComposerProjectDataAdoption(
  projectPath: string,
  input: import("../../shared/composer").ProjectDataAdoptionInput,
) {
  return api().assessProjectDataAdoption(projectPath, input);
}

export function editComposerProjectData(
  projectPath: string,
  input: import("../../shared/composer").ComposerProjectDataEditInput,
) {
  return api().editProjectData(projectPath, JSON.parse(JSON.stringify(input)));
}

export function createComposerProjectDataDraft(
  projectPath: string,
  input: import("../../shared/composer").ProjectDataAdoptionInput,
) {
  return api().createProjectDataDraft(projectPath, JSON.parse(JSON.stringify(input)));
}

export function applyComposerProjectDataCutover(
  projectPath: string,
  input: import("../../shared/composer").ProjectDataCutoverInput,
) {
  return api().applyProjectDataCutover(projectPath, JSON.parse(JSON.stringify(input)));
}

export function revealComposerProjectData(projectPath: string, relativeFile: string) {
  return api().revealProjectData(projectPath, relativeFile);
}

/** Write clean serialized `.astro` for an editable model (self-write marked). */
export function writeComposerPage(
  projectPath: string,
  relativeFile: string,
  model: AstroDocumentModel,
  expectedMtimeMs?: number | null,
): Promise<ComposerWritePageResult> {
  return api().writePage(projectPath, relativeFile, model, expectedMtimeMs);
}

export function commitComposerEditTransaction(
  transaction: ComposerEditTransaction,
): Promise<ComposerEditTransactionResult> {
  return api().commitTransaction(transaction);
}

/** Extract prop schema for a component import used by the current page. */
export function extractComposerPropSchema(
  projectPath: string,
  fromRelativeFile: string,
  importSpec: string,
): Promise<ComposerPropSchemaResult> {
  return api().extractPropSchema(projectPath, fromRelativeFile, importSpec);
}

export function writeComposerComponentControlMetadata(
  projectPath: string,
  relativeFile: string,
  metadata: import("../../shared/conditions").ComponentControlMetadata,
  expectedMtimeMs?: number | null,
) {
  return api().writeComponentControlMetadata(
    projectPath,
    relativeFile,
    JSON.parse(JSON.stringify(metadata)),
    expectedMtimeMs,
  );
}

export function detectComposerFrameworks(projectPath: string) {
  return api().detectFrameworks(projectPath);
}

export function prepareComposerComponentPreview(
  projectPath: string,
  componentFile: string,
  override?: Partial<
    Pick<
      import("../../shared/composer").ComposerComponentPreviewData,
      "props" | "slots"
    >
  > | null,
) {
  return api().prepareComponentPreview(projectPath, componentFile, override);
}
