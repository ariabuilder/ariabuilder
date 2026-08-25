import type { PropField } from "./types";

export const COMPOSER_COMPONENT_AUTHORING_ROUTE = "/__aria/component-authoring";
export const COMPOSER_COMPONENT_THUMBNAIL_ROUTE = "/__aria/component-thumbnail";

/** True for Aria-injected preview/authoring routes that must not run site middleware. */
export function isAriaManagedRoute(route: string): boolean {
  const normalized = (route.trim() || "/").replace(/\/+$/, "") || "/";
  return (
    normalized === "/aria-preview" ||
    normalized.startsWith("/aria-preview/") ||
    normalized === "/__aria" ||
    normalized.startsWith("/__aria/")
  );
}

export type ComposerPreviewValue =
  | string
  | number
  | boolean
  | Record<string, string>;

export type ComposerComponentPreviewDiagnostic = {
  field: string;
  message: string;
  severity: "warning" | "error";
};

export type ComposerComponentPreviewData = {
  props: Record<string, ComposerPreviewValue>;
  slots: Record<string, string>;
  diagnostics: ComposerComponentPreviewDiagnostic[];
};

export type ComposerComponentPreviewSession = {
  componentFile: string;
  route: string;
  revision: number;
  data: ComposerComponentPreviewData;
};

export type ComposerCmsPreviewEntry = {
  id: string;
  slug: string;
  title: string;
  status?: string;
  locale?: string;
  route: string;
};

export type ComposerCmsEntryTemplatePreviewContext = {
  collectionId: string;
  collectionName: string;
  collectionLabel: string;
  templateFile: string;
  entries: ComposerCmsPreviewEntry[];
  selectedEntryId: string | null;
  previewRoute: string | null;
  sourceKind?: import("../types").CollectionSourceKind;
  writable?: boolean;
  writableTextFields?: string[];
};

/** One exact rendered component invocation in an inline editing trail. */
export type ComposerComponentInstanceSegment = {
  /** Source file that owns the component invocation. */
  ownerFile: string;
  /** Marker path of the invocation within ownerFile. */
  hostPath: string;
  /** Rendered occurrence for loops/repeated output from the same source path. */
  occurrence: number;
};

export type ComposerDocumentLaunchRequest =
  | { mode: "page"; route: string }
  | {
      mode: "cms-entry-template";
      name: string;
      file: string;
      context: ComposerCmsEntryTemplatePreviewContext;
    }
  | {
      mode: "standalone-component";
      kind: "component" | "layout";
      name: string;
      file: string;
    }
  | {
      mode: "inline-component";
      kind: "component" | "layout";
      name: string;
      file: string;
      parentFile: string;
      hostPath: string;
      occurrence: number;
      instanceChain?: ComposerComponentInstanceSegment[];
    };

function encodedEntryPath(value: string): string {
  return value.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** Resolve an actual preview URL while the editable document remains a dynamic Astro template. */
export function resolveCmsEntryPreviewRoute(input: {
  urlPattern?: string | null;
  templateRoute: string;
  id: string;
  slug?: string | null;
  locale?: string | null;
}): string {
  const id = encodedEntryPath(input.id);
  const slug = encodedEntryPath(input.slug?.trim() || input.id);
  const locale = encodeURIComponent(input.locale?.trim() || "");
  let route = input.urlPattern?.trim() || input.templateRoute.trim() || "/";
  route = route
    .replace(/\{slug\}|:slug\b/g, slug)
    .replace(/\{id\}|:id\b/g, id)
    .replace(/\{locale\}|:locale\b/g, locale)
    .replace(/\[\.\.\.(?:id|slug)\]/g, slug)
    .replace(/\[(?:id|slug)\]/g, slug)
    .replace(/\[locale\]/g, locale);
  route = route.replace(/\/+/g, "/");
  if (!route.startsWith("/")) route = `/${route}`;
  return route.length > 1 ? route.replace(/\/$/, "") : route;
}

/** ISO timestamps JSON can carry; harness source revives them into `Date`. */
export function previewDatePropKeys(fields: readonly PropField[]): string[] {
  return fields.filter((field) => field.type === "date").map((field) => field.name);
}

export function previewDateRevivalSource(dateKeys: readonly string[]): string {
  if (!dateKeys.length) return "";
  return `\n${dateKeys
    .map(
      (key) =>
        `ariaPreviewProps[${JSON.stringify(key)}] = new Date(ariaPreviewProps[${JSON.stringify(key)}]);`,
    )
    .join("\n")}`;
}

function readableName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : "Preview value";
}

function literalDefault(field: PropField): ComposerPreviewValue | undefined {
  if (field.defaultExpr || field.default === undefined) return undefined;
  return field.default;
}

/** Build safe, editor-only values for rendering a component in isolation. */
export function deriveComposerComponentPreviewData(
  fields: readonly PropField[],
  slots: readonly string[],
): ComposerComponentPreviewData {
  const props: Record<string, ComposerPreviewValue> = {};
  const diagnostics: ComposerComponentPreviewDiagnostic[] = [];

  for (const field of fields) {
    const literal = literalDefault(field);
    if (literal !== undefined) {
      props[field.name] = literal;
      continue;
    }
    if (field.optional) continue;

    switch (field.type) {
      case "enum":
        if (field.options?.length) props[field.name] = field.options[0]!;
        else {
          diagnostics.push({
            field: field.name,
            severity: "warning",
            message: `Required prop ${field.name} has no enum option to preview.`,
          });
        }
        break;
      case "string":
        props[field.name] = readableName(field.name);
        break;
      case "number":
        props[field.name] = 0;
        break;
      case "boolean":
        props[field.name] = true;
        break;
      case "date":
        props[field.name] = "2026-01-15T12:00:00";
        break;
      case "attrs":
        props[field.name] = {};
        break;
      default:
        diagnostics.push({
          field: field.name,
          severity: "warning",
          message: `Required prop ${field.name} needs a value before the standalone preview can render it.`,
        });
    }
  }

  const previewSlots: Record<string, string> = {};
  for (const rawName of slots) {
    const name = rawName.trim() || "default";
    previewSlots[name] =
      name === "default" ? "Component preview" : `${readableName(name)} content`;
  }

  return { props, slots: previewSlots, diagnostics };
}

export function mergeComposerComponentPreviewData(
  generated: ComposerComponentPreviewData,
  override?: Partial<Pick<ComposerComponentPreviewData, "props" | "slots">> | null,
): ComposerComponentPreviewData {
  return {
    props: { ...generated.props, ...(override?.props ?? {}) },
    slots: { ...generated.slots, ...(override?.slots ?? {}) },
    diagnostics: generated.diagnostics,
  };
}
