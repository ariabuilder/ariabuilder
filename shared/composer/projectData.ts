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
