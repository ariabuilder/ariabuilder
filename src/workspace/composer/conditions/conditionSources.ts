import { astroCollectionBindingForNode } from "../../../../shared/composer/collectionBindings";
import { locateAtPath } from "../../../../shared/composer/mutate";
import type { AstroCollectionBinding, AstroDocumentModel, EditableNode, MapNode, PropField, PropValue } from "../../../../shared/composer/types";
import type { FieldSchema } from "../../../../shared/cms/fieldSchema";
import { buildExternalFieldDescriptors } from "../../../../shared/externalCollectionEntries";
import type { AriaCollectionDef } from "../../../../shared/types";
import {
  createConditionSourceOption,
  type ConditionEvaluationContext,
  type ConditionSourceOption,
  type ConditionValueType,
} from "../../../../shared/conditions";

function valueTypeForField(field: PropField): ConditionValueType {
  if (field.type === "string" || field.type === "enum" || field.type === "date") return "string";
  if (field.type === "number" || field.type === "boolean") return field.type;
  if (field.type === "attrs") return "object";
  return "unknown";
}

export function componentConditionSources(fields: readonly PropField[]): ConditionSourceOption[] {
  return fields.map((field) => createConditionSourceOption({
    provider: "component",
    path: [field.name],
    label: field.name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
    valueType: valueTypeForField(field),
    options: field.options?.map((value) => ({ label: value, value })),
  }));
}

function frontmatterBindings(frontmatter: string): string[] {
  const found = new Set<string>();
  for (const match of frontmatter.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

function mapAtOrAbove(model: AstroDocumentModel, path: string | null): MapNode | null {
  if (!path) return null;
  const parts = path.split(".");
  for (let length = parts.length; length > 0; length -= 1) {
    const candidate = locateAtPath(model.nodes, parts.slice(0, length).join("."))?.node;
    if (candidate?.kind === "map") return candidate;
  }
  return null;
}

function expressionText(node: EditableNode): string[] {
  const values: string[] = [];
  if (node.kind === "expr") values.push(node.value);
  if (node.kind === "map") values.push(node.head);
  if (node.kind === "conditional") values.push(node.test);
  if ("props" in node) {
    for (const prop of Object.values(node.props)) if ("value" in prop) values.push(prop.value);
  }
  const children = node.kind === "conditional"
    ? [...node.consequent, ...(node.alternate ?? [])]
    : node.kind === "map" || node.kind === "fragment"
      ? node.children
      : "children" in node && Array.isArray(node.children)
        ? node.children
        : [];
  for (const child of children) values.push(...expressionText(child));
  return values;
}

function cmsValueType(type: string): ConditionValueType {
  if (["number", "integer"].includes(type)) return "number";
  if (type === "boolean") return "boolean";
  if (["date", "datetime"].includes(type)) return "date";
  if (["multiSelect", "repeater"].includes(type)) return "array";
  if (["json", "object", "structuredText", "image", "reference", "relation", "link"].includes(type)) return "object";
  if (["string", "text", "slug", "select", "color", "icon", "file", "richtext"].includes(type)) return "string";
  return "unknown";
}

type CmsFieldChoice = {
  path: string[];
  label: string;
  valueType: ConditionValueType;
  options?: Array<{ label: string; value: unknown }>;
};

function flattenCmsFields(fields: readonly FieldSchema[], prefix: string[] = []): CmsFieldChoice[] {
  return fields.flatMap((field) => {
    const path = [...prefix, field.key];
    const choice: CmsFieldChoice = {
      path,
      label: field.label || field.key,
      valueType: cmsValueType(field.type),
      options: field.options?.map((option) => ({ label: option, value: option })),
    };
    // Object children have a stable property path. Repeater children require an
    // item scope of their own, so offering them here would compile invalid access.
    return field.type === "object"
      ? [choice, ...flattenCmsFields(field.fields ?? [], path)]
      : [choice];
  });
}

function collectionForBinding(
  binding: AstroCollectionBinding | null | undefined,
  collections: readonly AriaCollectionDef[],
): AriaCollectionDef | null {
  for (const name of binding?.collections ?? []) {
    const collection = collections.find((candidate) => candidate.name === name || candidate.id === name);
    if (collection) return collection;
  }
  return null;
}

function cmsFieldChoices(collection: AriaCollectionDef | null): CmsFieldChoice[] {
  const schemaFields = collection?.schema?.fields ?? [];
  const choices = flattenCmsFields(schemaFields);
  const known = new Set(choices.map((choice) => choice.path.join(".")));
  const inferred = buildExternalFieldDescriptors([], collection?.source?.inspectionEntries ?? []);
  for (const field of inferred) {
    if (known.has(field.key)) continue;
    choices.push({ path: [field.key], label: field.label, valueType: cmsValueType(field.type) });
  }
  return choices;
}

function entryCmsSources(input: {
  variable: string;
  label: string;
  collection: AriaCollectionDef | null;
  description: string;
}): ConditionSourceOption[] {
  const system: CmsFieldChoice[] = [
    { path: ["id"], label: "Entry ID", valueType: "string" },
    { path: ["collection"], label: "Collection", valueType: "string" },
    { path: ["data", "slug"], label: "Slug", valueType: "string" },
    { path: ["data", "title"], label: "Title", valueType: "string" },
    { path: ["body"], label: "Body", valueType: "string" },
  ];
  const custom = cmsFieldChoices(input.collection).map((field) => ({
    ...field,
    path: ["data", ...field.path],
  }));
  const seen = new Set<string>();
  return [
    createConditionSourceOption({
      provider: "cms",
      path: [input.variable],
      label: input.label,
      valueType: "object",
      description: input.description,
    }),
    ...[...custom, ...system]
      .filter((field) => {
        const key = field.path.join(".");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((field) => createConditionSourceOption({
        provider: "cms",
        path: [input.variable, ...field.path],
        label: `${input.label} · ${field.label}`,
        valueType: field.valueType,
        options: field.options,
        description: input.description,
      })),
  ];
}

function currentCmsItemSources(
  model: AstroDocumentModel,
  selectedPath: string | null,
  collections: readonly AriaCollectionDef[],
): ConditionSourceOption[] {
  const loop = mapAtOrAbove(model, selectedPath);
  const binding = loop ? astroCollectionBindingForNode(loop, model.collectionBindings ?? {}) : null;
  if (!loop || !binding) return [];
  const item = /\.map\s*\(\s*(?:async\s*)?\(?\s*([A-Za-z_$][\w$]*)/.exec(loop.head)?.[1];
  if (!item) return [];
  const referencedFields = new Set<string>();
  const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const reference = new RegExp(`\\b${escaped}((?:\\.[A-Za-z_$][\\w$]*)+)`, "g");
  for (const text of loop.children.flatMap(expressionText)) {
    for (const match of text.matchAll(reference)) if (match[1]) referencedFields.add(match[1].slice(1));
  }
  const collection = collectionForBinding(binding, collections);
  const sources = entryCmsSources({
    variable: item,
    label: "Current item",
    collection,
    description: collection
      ? `A field from the current ${collection.label} entry.`
      : "A field from the current CMS loop item.",
  });
  const existing = new Set(sources.map((source) => source.source.path.join(".")));
  for (const field of [...referencedFields].sort()) {
    const path = `${item}.${field}`;
    if (existing.has(path)) continue;
    sources.push(createConditionSourceOption({
      provider: "cms",
      path: [item, ...field.split(".")],
      label: `Current item · ${field.replace(/\./g, " · ")}`,
      valueType: "unknown",
      description: "A field referenced by the current CMS loop item.",
    }));
  }
  return sources;
}

export function conditionSourcesForDocument(
  model: AstroDocumentModel | null,
  selectedPath: string | null = null,
  collections: readonly AriaCollectionDef[] = [],
): ConditionSourceOption[] {
  const sources = componentConditionSources(model?.propSchema ?? []);
  if (model) sources.push(...currentCmsItemSources(model, selectedPath, collections));
  for (const binding of frontmatterBindings(model?.extraFrontmatter ?? "")) {
    const cmsBinding = model?.collectionBindings?.[binding];
    if (!cmsBinding) {
      sources.push(createConditionSourceOption({
        provider: "page",
        path: [binding],
        label: binding.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()),
        valueType: "unknown",
      }));
      continue;
    }
    const collection = collectionForBinding(cmsBinding, collections);
    const label = collection?.label ?? cmsBinding.collections[0]?.replace(/[-_]+/g, " ").replace(/^./, (letter) => letter.toUpperCase()) ?? "CMS content";
    if (cmsBinding.cardinality === "one") {
      sources.push(...entryCmsSources({
        variable: binding,
        label,
        collection,
        description: `A field from the ${label} entry available on this page.`,
      }));
    } else if (cmsBinding.cardinality === "many") {
      sources.push(
        createConditionSourceOption({
          provider: "cms",
          path: [binding],
          label: `${label} collection`,
          valueType: "array",
          description: `The ${label} entries loaded by this page.`,
        }),
        createConditionSourceOption({
          provider: "cms",
          path: [binding, "length"],
          label: `${label} · Item count`,
          valueType: "number",
          description: `How many ${label} entries are loaded by this page.`,
        }),
      );
    } else {
      sources.push(createConditionSourceOption({
        provider: "cms",
        path: [binding],
        label,
        valueType: "unknown",
        description: `${label} content available on this page. Its entry shape could not be determined statically.`,
      }));
    }
  }
  sources.push(
    createConditionSourceOption({ provider: "locale", label: "Locale", valueType: "string" }),
    createConditionSourceOption({ provider: "route", path: ["pathname"], label: "Page path", valueType: "string" }),
    createConditionSourceOption({ provider: "route", path: ["searchParams"], label: "Query parameters", valueType: "object" }),
    createConditionSourceOption({ provider: "site", path: ["hostname"], label: "Site hostname", valueType: "string" }),
    createConditionSourceOption({ provider: "time", path: ["today"], label: "Today", valueType: "date" }),
  );
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.source.provider}:${source.source.path.join(".")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function literalProp(value: PropValue | undefined): unknown {
  if (!value) return undefined;
  if (value.type === "bare") return true;
  if (value.type === "string" || value.type === "template-literal") return value.value;
  if (value.type !== "expr") return undefined;
  const text = value.value.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  if (text === "null") return null;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (/^(["']).*\1$/.test(text)) return text.slice(1, -1);
  return undefined;
}

export function componentConditionContext(
  fields: readonly PropField[],
  props: Record<string, PropValue>,
  routePath?: string | null,
): ConditionEvaluationContext {
  const component = Object.fromEntries(fields.map((field) => {
    const literal = literalProp(props[field.name]);
    return [field.name, literal !== undefined ? literal : field.default];
  }));
  return {
    providers: {
      component,
      ...(routePath ? { route: { pathname: routePath } } : {}),
    },
  };
}
