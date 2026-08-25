import type { FieldSchema } from "../cms";

export type ComposerDataOwnership = "project" | "cms" | "computed";
export type ComposerDataShape =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object"
  | "unknown";

export type ProjectDataSourceRange = { from: number; to: number };

export type ProjectDataCatalogGroupId = "current-item" | "page" | "project";
export type ProjectDataDerivation = "literal" | "asset" | "derived" | "unresolved";
export type ProjectDataTargetKind = "text" | "prop" | "collection";

export type ProjectDataCatalogTarget = {
  kind: ProjectDataTargetKind;
  propName?: string;
};

export type ProjectDataInstanceSegment = {
  ownerFile: string;
  hostPath: string;
  occurrence: number;
};

export type ProjectDataImportBinding = {
  sourceFile: string;
  exportName: string;
  specifier: string;
  suggestedLocalName: string;
};

export type ProjectDataCatalogField = {
  id: string;
  group: ProjectDataCatalogGroupId;
  label: string;
  pathLabel: string;
  expression: string;
  shape: ComposerDataShape;
  derivation: ProjectDataDerivation;
  valuePath: string[];
  value?: unknown;
  compatible: boolean;
  bindable: boolean;
  writable: boolean;
  reason?: string;
  sourceFile?: string;
  sourceHash?: string;
  sourceRange?: ProjectDataSourceRange;
  rootExport?: string;
  itemCount?: number;
  selectedItem?: number;
  importBinding?: ProjectDataImportBinding;
  rootId?: string;
};

export type ProjectDataCatalogRoot = {
  id: string;
  group: ProjectDataCatalogGroupId;
  label: string;
  expression: string;
  shape: ComposerDataShape;
  fieldIds: string[];
  sourceFile?: string;
  itemCount?: number;
};

export type ProjectDataCatalogSource = {
  id: string;
  file: string;
  kind: "astro" | "module" | "json" | "asset";
  sourceHash?: string;
  editable: boolean;
};

export type ProjectDataCatalogGroup = {
  id: ProjectDataCatalogGroupId;
  label: string;
  fields: ProjectDataCatalogField[];
  roots: ProjectDataCatalogRoot[];
};

export type ProjectDataCatalogInput = {
  relativeFile: string;
  /** Exact source loaded from disk. Source hashes and edit ranges refer to this text. */
  source: string;
  /** Current Composer source used only to resolve the selected node and expression. */
  selectionSource?: string;
  selectionPath: string;
  occurrence: number;
  target: ProjectDataCatalogTarget;
  instanceChain?: ProjectDataInstanceSegment[];
  refresh?: boolean;
};

export type ProjectDataCatalogResult = {
  groups: ProjectDataCatalogGroup[];
  sources: ProjectDataCatalogSource[];
  selectedFieldId?: string;
  expression?: string;
  managed: boolean;
  targetPath: string;
  target: ProjectDataCatalogTarget;
  scannedAt: string;
};

export type ProjectDataCatalogEditInput = {
  sourceFile: string;
  expectedSourceHash: string;
  sourceRange: ProjectDataSourceRange;
  value: string | number | boolean | null;
};

export type ProjectDataCatalogEditResult = {
  ok: true;
  sourceFile: string;
  sourceHash: string;
  value: unknown;
};

export type ComposerDataBinding = {
  ownership: ComposerDataOwnership;
  expression: string;
  displayName: string;
  valuePath: string[];
  shape: ComposerDataShape;
  itemCount?: number;
  value?: unknown;
  writable: boolean;
  reason?: string;
  sourceFile?: string;
  sourceHash?: string;
  sourceRange?: ProjectDataSourceRange;
  rootExport?: string;
  rootValue?: Record<string, unknown>;
};

export type ComposerDataInspectionInput = {
  relativeFile: string;
  source: string;
  expression: string;
};

export type ComposerDataInspectionResult = {
  binding: ComposerDataBinding;
};

export type ComposerProjectDataEditInput = ComposerDataInspectionInput & {
  expectedSourceHash: string;
  valuePath: string[];
  value: string | number | boolean | null;
};

export type ComposerProjectDataEditResult = {
  ok: true;
  sourceFile: string;
  sourceHash: string;
  value: unknown;
};

export type ProjectDataAdoptionField = {
  field: FieldSchema;
  selected: boolean;
  warnings: string[];
};

export type ProjectDataConsumerAssessment = {
  id: string;
  file: string;
  expression: string;
  valuePath: string[];
  status: "safe" | "manual" | "unresolved";
  reason?: string;
  sourceHash?: string;
  sourceRange?: ProjectDataSourceRange;
};

export type ProjectDataAdoptionAssessment = {
  previewHash: string;
  sourceHash: string;
  sourceFile: string;
  rootExport: string;
  collectionName: string;
  collectionLabel: string;
  entryTitle: string;
  entrySlug: string;
  fields: ProjectDataAdoptionField[];
  frontmatter: Record<string, unknown>;
  consumers: ProjectDataConsumerAssessment[];
  warnings: string[];
};

export type ProjectDataAdoptionInput = ComposerDataInspectionInput & {
  expectedPreviewHash?: string;
  collectionName?: string;
  collectionLabel?: string;
  entryTitle?: string;
  entrySlug?: string;
  selectedFields?: string[];
};

export type ProjectDataAdoptionResult = {
  ok: true;
  collectionId: string;
  collectionName: string;
  entryId: string;
  entrySlug: string;
  status: "draft";
  sourceChanged: false;
};

export type ProjectDataCutoverInput = ProjectDataAdoptionInput & {
  expectedPreviewHash: string;
  collectionId: string;
  consumerIds: string[];
};

export type ProjectDataCutoverResult = {
  ok: true;
  changedFiles: string[];
  cutoverConsumers: string[];
  retainedSourceFile: string;
};
