/**
 * Prop schema extraction from Astro frontmatter.
 *
 * Sources:
 * - `interface Props` / `type Props = { … }`
 * - `type Props = CollectionEntry<'x'>['data']` plus `Astro.props` destructure
 * - `const { … } = Astro.props` destructure defaults
 * - template truthiness guards (`field &&`) mark alias-only fields optional
 * - `interface Props extends HTMLAttributes<"tag">` → extendsTag
 */

import type { PropField, PropFieldType } from "./types";
import { parseComponentControlMetadata } from "../conditions/componentControlMetadata";

export type PropSchemaResult = {
  fields: PropField[];
  extendsTag: string | null;
  slots: string[];
  /**
   * `...rest` on `Astro.props` — component forwards arbitrary attributes.
   * Inspector shows a free-form Attributes section (Stacki pattern).
   */
  hasRest: boolean;
  controlMetadataFound?: boolean;
  controlMetadataValid?: boolean;
  controlMetadataError?: string;
};

function normalizeType(t: string): {
  type: PropFieldType;
  options?: string[];
} {
  const parts = t
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length > 1) {
    const literals = parts.filter((p) => /^(['"`]).*\1$/.test(p));
    const rest = parts.filter((p) => !/^(['"`]).*\1$/.test(p));
    if (
      literals.length >= 2 &&
      rest.every((p) => p === "undefined" || p === "null")
    ) {
      return {
        type: "enum",
        options: literals.map((p) => p.slice(1, -1)),
      };
    }
  }
  if (/^string\b/.test(t)) return { type: "string" };
  if (/^number\b/.test(t)) return { type: "number" };
  if (/^boolean\b/.test(t)) return { type: "boolean" };
  if (/^Date\b/.test(t)) return { type: "date" };
  if (/^(['"`]).*\1$/.test(t)) return { type: "string" };
  if (/^(HTMLAttributes\b|astroHTML\.|Record\s*<)/.test(t)) {
    return { type: "attrs" };
  }
  return { type: "other" };
}

function extractExtendsTag(frontmatter: string): string | null {
  const m = frontmatter.match(
    /interface\s+Props\s+extends\s+(?:astroHTML\.JSX\.)?HTMLAttributes\s*<\s*['"](\w+)['"]\s*>/,
  );
  return m ? m[1]! : null;
}

function inferTypeFromName(name: string): PropFieldType | null {
  if (
    /date/i.test(name) ||
    /^(created|updated|published|modified)At$/i.test(name)
  ) {
    return "date";
  }
  if (
    /^(title|description|label|name|slug|heading|subtitle|excerpt|summary|href|url)$/i.test(
      name,
    )
  ) {
    return "string";
  }
  return null;
}

function isTruthyGuardedInTemplate(template: string, name: string): boolean {
  const id = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(String.raw`\b${id}\s*(&&|\?\?|\|\|)`).test(template);
}

function extractSlotsFromTemplate(templateSource: string): string[] {
  const found = new Set<string>();
  const re =
    /<slot\b((?:[^>"'{]|"[^"]*"|'[^']*'|\{[^}]*\})*?)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(templateSource)) !== null) {
    const nameMatch = m[1]?.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)')/);
    found.add(nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? "default") : "default");
  }
  const named = [...found].filter((s) => s !== "default");
  return found.has("default") ? ["default", ...named] : named;
}

/**
 * Extract prop schema + slots from a full `.astro` source string.
 * Slots are scanned from the template body (after frontmatter).
 */
export function extractPropSchema(source: string): PropSchemaResult {
  const fm = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const frontmatter = fm ? fm[1]! : "";
  const body = fm ? source.slice(fm[0].length) : source;
  const schema = new Map<string, PropField>();
  const controls = parseComponentControlMetadata(source);

  const aliases = new Map<string, string>();
  const aliasRe = /(?:export\s+)?type\s+(\w+)\s*=\s*([\s\S]*?);/g;
  let am: RegExpExecArray | null;
  while ((am = aliasRe.exec(frontmatter)) !== null) {
    if (am[1] !== "Props") aliases.set(am[1]!, am[2]!.trim());
  }

  const iface = frontmatter.match(
    /(?:export\s+)?(?:interface|type)\s+Props\s*(?:extends\s+[^{]+)?(?:=\s*)?\{([\s\S]*?)\n\}/,
  );
  const hasParsedPropsObject = Boolean(iface);
  if (iface) {
    const entryRe = /^\s*(\w+)(\?)?\s*:\s*([^;\n]+?)[;,]?\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(iface[1]!)) !== null) {
      let typeStr = m[3]!.trim();
      if (aliases.has(typeStr)) typeStr = aliases.get(typeStr)!;
      const { type, options } = normalizeType(typeStr);
      schema.set(m[1]!, {
        name: m[1]!,
        type,
        options,
        optional: !!m[2],
        default: undefined,
      });
    }
  }

  const destructure = frontmatter.match(
    /(?:const|let)\s*\{([\s\S]*?)\}\s*=\s*Astro\.props/,
  );
  if (destructure) {
    let bodyInner = destructure[1]!
      .replace(/\.\.\.\s*\w+/g, "")
      .replace(/(\w+)\s*:\s*\w+/g, "$1");
    const entryRe =
      /(\w+)(?:\s*=\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\{[^{}]*\}|\[[^\][]*\]|[^,\n}]+))?/g;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(bodyInner)) !== null) {
      if (!m[1]) continue;
      const existing: PropField = schema.get(m[1]) ?? {
        name: m[1],
        type: inferTypeFromName(m[1]) ?? "other",
        optional: hasParsedPropsObject,
        default: undefined,
      };
      if (m[2] !== undefined) {
        let def = m[2].trim();
        if (/^["'`]/.test(def)) {
          existing.default = def.slice(1, -1);
          if (existing.type === "other") existing.type = "string";
        } else if (/^(true|false)$/.test(def)) {
          existing.default = def === "true";
          if (existing.type === "other") existing.type = "boolean";
        } else if (/^-?\d+(\.\d+)?$/.test(def)) {
          existing.default = Number(def);
          if (existing.type === "other") existing.type = "number";
        } else {
          existing.default = def;
          existing.defaultExpr = true;
          if (existing.type === "other" && /^\{/.test(def)) {
            existing.type = "attrs";
          }
        }
        existing.optional = true;
      }
      schema.set(m[1], existing);
    }
  }

  // Rest is always last in the destructure; anchor to `} = Astro.props` so a
  // `}` inside an earlier default (`containerAttrs = {}`) does not false-positive.
  const hasRest =
    /\.\.\.\s*\w+\s*\}\s*(?::[^=]+)?=\s*Astro\.props/.test(frontmatter);

  if (!hasParsedPropsObject) {
    for (const field of schema.values()) {
      if (
        !field.optional &&
        field.default === undefined &&
        isTruthyGuardedInTemplate(body, field.name)
      ) {
        field.optional = true;
      }
    }
  }

  const fields = [...schema.values()].map((field) => ({
    ...field,
    visibleWhen: controls.metadata.fields[field.name]?.visibleWhen,
    enabledWhen: controls.metadata.fields[field.name]?.enabledWhen,
  }));

  return {
    fields,
    extendsTag: extractExtendsTag(frontmatter),
    slots: extractSlotsFromTemplate(body),
    hasRest,
    controlMetadataFound: controls.found,
    controlMetadataValid: controls.valid,
    controlMetadataError: controls.error,
  };
}
