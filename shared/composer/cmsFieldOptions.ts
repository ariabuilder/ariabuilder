import type { FieldSchema } from "../cms";
import type { AriaCollectionDef } from "../types";
import type { CmsRelationTraversal } from "./cmsBindings";

export type CmsQuickTargetKind = "text" | "image" | "alt" | "link";

export type CmsBindingFieldOption = {
  label: string;
  path: string;
  type: string;
  depth: number;
  isList: boolean;
  source: "system" | "schema";
  compatibility?: readonly CmsQuickTargetKind[];
  suggestions?: readonly CmsQuickTargetKind[];
  relation?: Omit<CmsRelationTraversal, "lookupVariable">;
};

export type CmsBindingFieldOptionGroup = {
  label: "Recommended" | "Other fields";
  options: CmsBindingFieldOption[];
};

const TEXT_TYPES = new Set([
  "string", "text", "slug", "url", "email", "date", "datetime",
  "number", "integer", "boolean", "rich-text", "richtext", "structuredText",
]);
const IMAGE_TYPES = new Set(["image", "file", "url", "string"]);
const LINK_TYPES = new Set(["url", "slug", "string", "reference"]);

function titleCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function systemOptions(prefix = "", labelPrefix = "", depth = 0): CmsBindingFieldOption[] {
  const values = [
    { key: "id", label: "Entry ID", type: "string" },
    { key: "slug", label: "Slug", type: "slug" },
    { key: "title", label: "Title", type: "string" },
    { key: "body", label: "Body", type: "rich-text" },
  ];
  return values.map((item) => ({
    label: labelPrefix ? `${labelPrefix} / ${item.label}` : item.label,
    path: prefix ? `${prefix}.${item.key}` : item.key,
    type: item.type,
    depth,
    isList: false,
    source: "system" as const,
  }));
}

function collectionFor(
  collections: readonly AriaCollectionDef[],
  key: string,
): AriaCollectionDef | null {
  return collections.find((collection) => collection.id === key || collection.name === key) ?? null;
}

function directSchemaOptions(
  fields: readonly FieldSchema[],
  collections: readonly AriaCollectionDef[],
  pathPrefix = "",
  labelPrefix = "",
  depth = 0,
  allowRelations = true,
): CmsBindingFieldOption[] {
  const options: CmsBindingFieldOption[] = [];
  for (const field of fields) {
    const path = pathPrefix ? `${pathPrefix}.${field.key}` : field.key;
    const label = labelPrefix ? `${labelPrefix} / ${field.label}` : field.label;
    const isList = field.type === "repeater" || field.type === "multiSelect" || field.type === "relation";
    options.push({
      label,
      path,
      type: field.type,
      depth,
      isList,
      source: "schema",
    });

    if (field.type === "object") {
      options.push(...directSchemaOptions(
        field.fields ?? [],
        collections,
        path,
        label,
        depth + 1,
        allowRelations,
      ));
    }

    if (field.type === "repeater") {
      options.push(...directSchemaOptions(
        field.fields ?? [],
        collections,
        `${path}.0`,
        `${label} / First item`,
        depth + 1,
        allowRelations,
      ));
    }

    if (field.type === "image") {
      options.push(
        { label: `${label} / Source`, path: `${path}.src`, type: "url", depth: depth + 1, isList: false, source: "schema" },
        { label: `${label} / URL`, path: `${path}.url`, type: "url", depth: depth + 1, isList: false, source: "schema" },
        { label: `${label} / Alt text`, path: `${path}.alt`, type: "string", depth: depth + 1, isList: false, source: "schema" },
        { label: `${label} / Caption`, path: `${path}.caption`, type: "string", depth: depth + 1, isList: false, source: "schema" },
        { label: `${label} / Width`, path: `${path}.width`, type: "number", depth: depth + 1, isList: false, source: "schema" },
        { label: `${label} / Height`, path: `${path}.height`, type: "number", depth: depth + 1, isList: false, source: "schema" },
      );
    }

    if (!allowRelations || (field.type !== "reference" && field.type !== "relation") || !field.targetCollection) {
      continue;
    }
    const target = collectionFor(collections, field.targetCollection);
    if (!target) continue;
    const relationPrefix = field.type === "relation" ? `${path}.0` : path;
    const relationLabel = field.type === "relation" ? `${label} / First item` : label;
    const relationBase = {
      sourceField: path,
      targetCollection: target.name,
      kind: field.type,
      ...(field.type === "relation" ? { index: 0 } : {}),
    } as const;
    const nested = [
      ...systemOptions("", "", depth + 1),
      ...directSchemaOptions(
        target.schema?.fields ?? [],
        collections,
        "",
        "",
        depth + 1,
        false,
      ),
    ];
    for (const option of nested) {
      options.push({
        ...option,
        label: `${relationLabel} / ${option.label}`,
        path: `${relationPrefix}.${option.path}`,
        depth: depth + 1,
        relation: {
          ...relationBase,
          targetField: option.path,
        },
      });
    }
  }
  return options;
}

export function createCmsBindingFieldOptions(
  collection: AriaCollectionDef,
  collections: readonly AriaCollectionDef[],
): CmsBindingFieldOption[] {
  const options = [
    ...systemOptions(),
    ...directSchemaOptions(collection.schema?.fields ?? [], collections),
  ];
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.path)) return false;
    seen.add(option.path);
    return true;
  }).map((option) => ({
    ...option,
    compatibility: (["text", "image", "alt", "link"] as const)
      .filter((target) => fieldOptionIsCompatible(option, target)),
    suggestions: suggestedTargets(option),
  }));
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function fieldOptionIsCompatible(
  option: CmsBindingFieldOption,
  target: CmsQuickTargetKind,
): boolean {
  if (target === "image") {
    return IMAGE_TYPES.has(option.type) || /(image|cover|photo|thumbnail|poster|avatar)/.test(normalized(option.path));
  }
  if (target === "link") {
    return LINK_TYPES.has(option.type) || /(url|href|link|permalink|slug)/.test(normalized(option.path));
  }
  if (target === "alt") {
    return option.type === "string" || option.type === "text" || /(alt|caption|title|name)/.test(normalized(option.path));
  }
  return TEXT_TYPES.has(option.type) || option.source === "system";
}

function suggestedTargets(option: CmsBindingFieldOption): CmsQuickTargetKind[] {
  const value = normalized(`${option.path} ${option.label}`);
  const suggestions: CmsQuickTargetKind[] = [];
  if (/(image|cover|thumbnail|photo|poster|avatar|\.src)/.test(value)) suggestions.push("image");
  if (/(alt|caption|title|name)/.test(value)) suggestions.push("alt");
  if (/(url|href|link|permalink|slug)/.test(value)) suggestions.push("link");
  if (/(title|heading|name|label|summary|description|excerpt|body|content|text)/.test(value)) suggestions.push("text");
  return suggestions;
}

export function cmsFieldOptionIsCompatible(
  option: CmsBindingFieldOption,
  target: CmsQuickTargetKind,
): boolean {
  return option.compatibility?.includes(target) ?? fieldOptionIsCompatible(option, target);
}

function suggestionScore(option: CmsBindingFieldOption, target: CmsQuickTargetKind, label: string): number {
  const value = normalized(`${option.path} ${option.label}`);
  const node = normalized(label);
  let score = cmsFieldOptionIsCompatible(option, target) ? 20 : 0;
  if (option.suggestions?.includes(target)) score += 3;
  const priorities = target === "image"
    ? ["image", "cover", "thumbnail", "photo", "poster", "avatar"]
    : target === "link"
      ? ["url", "permalink", "href", "link", "slug"]
      : target === "alt"
        ? ["alt", "caption", "title", "name"]
        : /^h[1-6]|heading/.test(node)
          ? ["title", "heading", "name", "label"]
          : ["summary", "description", "excerpt", "body", "content", "text", "title"];
  priorities.forEach((key, index) => {
    if (value.includes(key)) score += Math.max(1, 12 - index * 2);
  });
  if (node && value.includes(node)) score += 4;
  if (option.relation) score -= 1;
  return score;
}

export function createCmsBindingFieldOptionGroups(
  options: readonly CmsBindingFieldOption[],
  target: CmsQuickTargetKind,
  nodeLabel: string,
  currentPath = "",
): CmsBindingFieldOptionGroup[] {
  const compatible = options
    .filter((option) => cmsFieldOptionIsCompatible(option, target) || option.path === currentPath)
    .map((option) => ({ option, score: suggestionScore(option, target, nodeLabel) }))
    .sort((a, b) => b.score - a.score || a.option.label.localeCompare(b.option.label));
  const recommended = compatible.filter((item) => item.score >= 24).map((item) => item.option);
  const other = compatible.filter((item) => item.score < 24).map((item) => item.option);
  return [
    ...(recommended.length ? [{ label: "Recommended" as const, options: recommended }] : []),
    ...(other.length ? [{ label: "Other fields" as const, options: other }] : []),
  ];
}

export function suggestedCmsFieldPath(
  groups: readonly CmsBindingFieldOptionGroup[],
): string {
  return groups[0]?.options[0]?.path ?? "";
}

export function cmsFieldPathLabel(path: string): string {
  return path.split(".").map((segment) => segment === "0" ? "First item" : titleCase(segment)).join(" / ");
}
