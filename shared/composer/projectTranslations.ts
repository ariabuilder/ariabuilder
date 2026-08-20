import type { FieldSchema } from "../cms";

export type ProjectLocaleResolver =
  | { kind: "path-prefix" }
  | { kind: "query-param"; parameter: string };

export type ProjectTranslationScalar = string | number | boolean | null;

export type ProjectTranslationSourceRange = {
  from: number;
  to: number;
};

export type TranslationCoverageIssue = {
  kind: "missing-key" | "shape-mismatch" | "unsupported-value";
  namespace: string;
  keyPath: string[];
  locale: string;
  message: string;
};

export type ProjectTranslationKey = {
  path: string[];
  label: string;
  values: Record<string, ProjectTranslationScalar | undefined>;
  sourceRanges: Record<string, ProjectTranslationSourceRange | undefined>;
  sourceFiles: Record<string, string | undefined>;
  complete: boolean;
  editable: boolean;
};

export type ProjectTranslationNamespace = {
  id: string;
  name: string;
  label: string;
  keys: ProjectTranslationKey[];
};

export type ProjectTranslationConsumer = {
  id: string;
  file: string;
  expression: string;
  namespace: string;
  keyPath: string[];
  contextVariable: string;
  localeExpression: string;
  sourceHash: string;
  sourceRange: ProjectTranslationSourceRange;
  status: "safe" | "manual" | "unresolved";
  reason?: string;
};

export type ProjectTranslationCatalog = {
  id: string;
  label: string;
  sourceFile: string;
  sourceHash: string;
  sourceFiles: Array<{ file: string; hash: string }>;
  exportName: string;
  locales: string[];
  defaultLocale: string;
  resolver: ProjectLocaleResolver;
  namespaces: ProjectTranslationNamespace[];
  diagnostics: TranslationCoverageIssue[];
  consumers: ProjectTranslationConsumer[];
  capabilities: {
    read: true;
    editScalar: boolean;
    adopt: boolean;
    bind: boolean;
  };
  unsupportedReason?: string;
};

export type ProjectTranslationCatalogResult = {
  catalogs: ProjectTranslationCatalog[];
  unsupported: Array<{
    sourceFile: string;
    exportName: string;
    reason: string;
  }>;
  scannedAt: string;
};

export type ProjectTranslationBinding = {
  catalogId: string;
  namespace: string;
  keyPath: string[];
  contextVariable: string;
  fallback?: string;
};

export type ProjectTranslationEditInput = {
  catalogId: string;
  locale: string;
  namespace: string;
  keyPath: string[];
  value: ProjectTranslationScalar;
  expectedSourceHash: string;
};

export type ProjectTranslationEditResult = {
  ok: true;
  sourceFile: string;
  sourceHash: string;
  value: ProjectTranslationScalar;
};

export type ProjectTranslationAdoptionNamespace = {
  namespace: string;
  label: string;
  collectionName: string;
  collectionLabel: string;
  schema: FieldSchema[];
  locales: string[];
  issues: TranslationCoverageIssue[];
  consumers: ProjectTranslationConsumer[];
  conflict?: string;
};

export type ProjectTranslationAdoptionInput = {
  catalogId: string;
  namespaces: string[];
  expectedCatalogHash?: string;
};

export type ProjectTranslationAdoptionAssessment = {
  catalogId: string;
  catalogHash: string;
  previewHash: string;
  defaultLocale: string;
  settingsCompatible: boolean;
  settingsReason?: string;
  namespaces: ProjectTranslationAdoptionNamespace[];
};

export type ProjectTranslationAdoptionResult = {
  ok: true;
  sourceChanged: false;
  targets: Array<{
    namespace: string;
    collectionId: string;
    collectionName: string;
    entryId: string;
  }>;
};

export type ProjectTranslationCutoverInput = ProjectTranslationAdoptionInput & {
  expectedPreviewHash: string;
  consumerIds: string[];
  targets: ProjectTranslationAdoptionResult["targets"];
};

export type ProjectTranslationCutoverResult = {
  ok: true;
  changedFiles: string[];
  cutoverConsumers: string[];
  retainedSourceFile: string;
};
