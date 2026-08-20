import type { FieldSchema, FieldType } from "./cms";
import type {
  ExternalCollectionEntry,
  ExternalFieldDescriptor,
} from "./types";

const IDENTITY_KEYS = ["title", "name", "label", "slug"] as const;
const IMAGE_KEYS = new Set([
  "cover",
  "coverimage",
  "coverphoto",
  "hero",
  "heroimage",
  "herophoto",
  "featuredimage",
  "featuredphoto",
  "image",
  "photo",
  "thumbnail",
  "avatar",
]);
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const ASTRO_IMAGE_MARKER = "__ASTRO_IMAGE_";

export type ExternalObservedFieldType =
  | "string"
  | "date"
  | "datetime"
  | "number"
  | "integer"
  | "boolean"
  | "array"
  | "object";

export type ExternalFieldObservation = {
  key: string;
  types: ExternalObservedFieldType[];
};

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function externalFieldLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function observedType(value: unknown): ExternalObservedFieldType | null {
  if (value == null) return null;
  if (Array.isArray(value)) return "array";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    if (DATE_ONLY_RE.test(value)) return "date";
    if (DATE_TIME_RE.test(value) && !Number.isNaN(Date.parse(value))) {
      return "datetime";
    }
    return "string";
  }
  return "string";
}

function inferredType(observed: ReadonlySet<ExternalObservedFieldType>): FieldType {
  if (observed.size === 0) return "string";
  if (observed.size === 1) {
    const [only] = observed;
    if (only === "array") return "json";
    return only ?? "string";
  }
  if ([...observed].every((type) => type === "integer" || type === "number")) {
    return "number";
  }
  if ([...observed].every((type) => type === "date" || type === "datetime")) {
    return "datetime";
  }
  return "json";
}

function isComplexType(type: FieldType): boolean {
  return ["json", "object", "repeater", "structuredText", "richtext"].includes(type);
}

function isSortableType(type: FieldType): boolean {
  return !isComplexType(type) && !["image", "file", "relation", "reference"].includes(type);
}

function isImageField(key: string, type: FieldType): boolean {
  return type === "image" || IMAGE_KEYS.has(normalizedKey(key));
}

function descriptor(
  field: Pick<FieldSchema, "key" | "label" | "type">,
  source: ExternalFieldDescriptor["source"],
): ExternalFieldDescriptor {
  return {
    key: field.key,
    label: field.label || externalFieldLabel(field.key),
    type: field.type,
    source,
    sortable: isSortableType(field.type),
    complex: isComplexType(field.type),
    image: isImageField(field.key, field.type),
  };
}

/** Schema order wins; record-only top-level keys follow in first-seen order. */
export function buildExternalFieldDescriptors(
  schemaFields: readonly FieldSchema[],
  entries: readonly ExternalCollectionEntry[],
): ExternalFieldDescriptor[] {
  const observations = new Map<string, Set<ExternalObservedFieldType>>();
  for (const entry of entries) {
    for (const [key, value] of Object.entries(entry.data)) {
      let types = observations.get(key);
      if (!types) {
        if (observations.size >= 250) continue;
        types = new Set();
        observations.set(key, types);
      }
      const type = observedType(value);
      if (type) types.add(type);
    }
  }
  return buildExternalFieldDescriptorsFromObservations(
    schemaFields,
    [...observations].map(([key, types]) => ({ key, types: [...types] })),
  );
}

export function buildExternalFieldDescriptorsFromObservations(
  schemaFields: readonly FieldSchema[],
  fieldObservations: readonly ExternalFieldObservation[],
): ExternalFieldDescriptor[] {
  const result: ExternalFieldDescriptor[] = [];
  const seen = new Set<string>();
  for (const field of schemaFields.slice(0, 250)) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    result.push(descriptor(field, "schema"));
  }

  for (const observation of fieldObservations) {
    if (result.length >= 250) break;
    const { key } = observation;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(
      descriptor(
        {
          key,
          label: externalFieldLabel(key),
          type: inferredType(new Set(observation.types)),
        },
        "inferred",
      ),
    );
  }
  return result;
}

function usefulString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export function getExternalEntryTitle(entry: ExternalCollectionEntry): string {
  for (const key of IDENTITY_KEYS) {
    const value = usefulString(entry.data[key]);
    if (value) return value;
  }
  return entry.id;
}

export function getExternalIdentityField(
  fields: readonly ExternalFieldDescriptor[],
): ExternalFieldDescriptor | null {
  for (const key of IDENTITY_KEYS) {
    const field = fields.find((candidate) => normalizedKey(candidate.key) === key);
    if (field) return field;
  }
  return null;
}

export function getExternalImageField(
  fields: readonly ExternalFieldDescriptor[],
): ExternalFieldDescriptor | null {
  return fields.find((field) => field.image) ?? null;
}

export function getSmartExternalVisibleFieldKeys(
  fields: readonly ExternalFieldDescriptor[],
  maxScalarFields = 3,
): string[] {
  const identity = getExternalIdentityField(fields);
  const image = getExternalImageField(fields);
  const selected: string[] = [];
  if (identity) selected.push(identity.key);
  if (image && image.key !== identity?.key) selected.push(image.key);

  // Inventory defaults favor compact identifiers and metadata. Long-form fields
  // such as description/body remain available from the column menu and entry view.
  const priorities = [
    "slug",
    "status",
    "locale",
    "publishedat",
    "pubdate",
    "publishdate",
    "datepublished",
    "updatedat",
    "modifiedat",
    "date",
    "author",
    "tags",
  ];
  const longFormKeys = new Set([
    "description",
    "summary",
    "excerpt",
    "content",
    "body",
  ]);
  const scalar = fields
    .filter((field) => !field.complex && !field.image && field.key !== identity?.key)
    .sort((a, b) => {
      const aPriority = priorities.indexOf(normalizedKey(a.key));
      const bPriority = priorities.indexOf(normalizedKey(b.key));
      if (aPriority === bPriority) {
        const aLongForm = longFormKeys.has(normalizedKey(a.key));
        const bLongForm = longFormKeys.has(normalizedKey(b.key));
        if (aLongForm !== bLongForm) return aLongForm ? 1 : -1;
        return 0;
      }
      if (aPriority < 0) return 1;
      if (bPriority < 0) return -1;
      return aPriority - bPriority;
    })
    .slice(0, maxScalarFields);
  for (const field of scalar) selected.push(field.key);
  return selected;
}

export function resolveProjectAssetId(sourceFile: string, relativeAsset: string): string | null {
  if (!sourceFile || !relativeAsset || relativeAsset.startsWith("/") || relativeAsset.includes("\\")) {
    return null;
  }
  const segments = sourceFile.split("/").slice(0, -1);
  for (const segment of relativeAsset.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const assetId = segments.join("/");
  return assetId.startsWith("src/assets/") || assetId.startsWith("public/")
    ? assetId
    : null;
}

function ariaMediaUrl(projectRoot: string, assetId: string): string {
  return `aria-media://asset/${encodeURIComponent(projectRoot)}/${encodeURIComponent(assetId)}`;
}

function imageUrlFromValue(
  value: unknown,
  entry: ExternalCollectionEntry,
  projectRoot?: string,
): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith(ASTRO_IMAGE_MARKER) && projectRoot && entry.filePath) {
      const assetId = resolveProjectAssetId(
        entry.filePath,
        trimmed.slice(ASTRO_IMAGE_MARKER.length),
      );
      return assetId ? ariaMediaUrl(projectRoot, assetId) : null;
    }
    return /^(https?:\/\/|\/|blob:|data:image\/)/i.test(trimmed) ? trimmed : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return usefulString(record.url) ?? usefulString(record.src);
}

export function getExternalEntryImageUrl(
  entry: ExternalCollectionEntry,
  fields: readonly ExternalFieldDescriptor[],
  projectRoot?: string,
): string | null {
  const field = getExternalImageField(fields);
  return field ? imageUrlFromValue(entry.data[field.key], entry, projectRoot) : null;
}

export function formatExternalFieldValue(value: unknown, type?: FieldType): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return new Intl.NumberFormat().format(value);
  if (typeof value === "string") {
    if ((type === "date" || type === "datetime") && !Number.isNaN(Date.parse(value))) {
      const options: Intl.DateTimeFormatOptions = type === "date"
        ? { dateStyle: "medium", timeZone: "UTC" }
        : { dateStyle: "medium", timeStyle: "short" };
      return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "Empty list";
    const primitivePreview = value
      .filter((item) => ["string", "number", "boolean"].includes(typeof item))
      .slice(0, 3)
      .map(String)
      .join(", ");
    return primitivePreview
      ? `${primitivePreview}${value.length > 3 ? ` +${value.length - 3}` : ""}`
      : `${value.length} item${value.length === 1 ? "" : "s"}`;
  }
  if (typeof value === "object") {
    const count = Object.keys(value as Record<string, unknown>).length;
    return `${count} field${count === 1 ? "" : "s"}`;
  }
  return String(value);
}
