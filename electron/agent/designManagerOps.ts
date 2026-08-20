/**
 * Pure Design Manager operations for agent tools.
 * All writers return a DesignPatch (or an error) so callers can apply with
 * expectedRevision fencing through patchDesignSystem.
 */

import type {
  DesignClassRule,
  DesignFontsourceFont,
  DesignGoogleFont,
  DesignPatch,
  DesignSnapshot,
  DesignVariableAlias,
  DesignVariableDefinition,
  DesignVariables,
} from "../../shared/design";
import { cloneDesignFonts, normalizeFontsourceId } from "../../shared/design";

export type DesignOpFail = { ok: false; message: string };
export type DesignOpPatch = { ok: true; patch: DesignPatch; detail?: Record<string, unknown> };

function sanitizeClassName(raw: string): string {
  return raw
    .trim()
    .replace(/^\./, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isValidClassName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name);
}

/** Design Manager persists full rules (selector + body), matching extractClassRules. */
function toClassRuleCss(name: string, cssText?: string): string {
  const trimmed = (cssText ?? "").trim();
  if (trimmed.startsWith(".")) return trimmed;
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return `.${name} ${trimmed}`;
  }
  const body = trimmed
    ? trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => (line.endsWith(";") ? `  ${line}` : `  ${line};`))
        .join("\n")
    : "  \n";
  return `.${name} {\n${body}\n}`;
}

function sequentialDuplicateName(source: string, existing: Set<string>): string {
  let n = 2;
  while (existing.has(`${source}-copy-${n}`) || (n === 2 && existing.has(`${source}-copy`))) {
    n += 1;
  }
  const candidate = n === 2 ? `${source}-copy` : `${source}-copy-${n}`;
  return existing.has(candidate) ? `${source}-copy-${Date.now()}` : candidate;
}

export function summarizeDesignClasses(snapshot: DesignSnapshot, includeUsage?: Record<string, number>) {
  return snapshot.classes.map((item) => ({
    name: item.name,
    source: item.source,
    css: item.css,
    usageCount: includeUsage?.[item.name] ?? undefined,
  }));
}

export function summarizeDesignFonts(snapshot: DesignSnapshot) {
  return {
    google: snapshot.fonts.google,
    custom: snapshot.fonts.custom,
    fontsource: snapshot.fonts.fontsource ?? [],
    bodyFamily: snapshot.fonts.bodyFamily ?? null,
    headingFamily: snapshot.fonts.headingFamily ?? null,
  };
}

/** Replace the managed class list; include current snapshot classes so we do not drop them. */
function withClasses(
  snapshot: DesignSnapshot,
  mutate: (classes: DesignClassRule[]) => DesignClassRule[] | DesignOpFail,
): DesignOpPatch | DesignOpFail {
  const current = snapshot.classes.map((item) => ({ ...item }));
  const next = mutate(current);
  if (!Array.isArray(next)) return next;
  return {
    ok: true,
    patch: { classes: next.map((item) => ({ ...item, source: "aria" as const })) },
  };
}

export function createClassPatch(
  snapshot: DesignSnapshot,
  nameRaw: string,
  cssText?: string,
): DesignOpPatch | DesignOpFail {
  const name = sanitizeClassName(nameRaw);
  if (!name || !isValidClassName(name)) {
    return { ok: false, message: "Provide a valid CSS class name (letters, numbers, _-)." };
  }
  const result = withClasses(snapshot, (classes) => {
    if (classes.some((item) => item.name === name)) {
      return { ok: false, message: `Class "${name}" already exists.` };
    }
    classes.push({
      name,
      css: toClassRuleCss(name, cssText),
      source: "aria",
    });
    return classes;
  });
  if (!result.ok) return result;
  return { ...result, detail: { name } };
}

export function updateClassRulePatch(
  snapshot: DesignSnapshot,
  nameRaw: string,
  cssText: string,
): DesignOpPatch | DesignOpFail {
  const name = sanitizeClassName(nameRaw);
  if (!name) return { ok: false, message: "Provide a class name." };
  return withClasses(snapshot, (classes) => {
    const index = classes.findIndex((item) => item.name === name);
    if (index < 0) return { ok: false, message: `Class "${name}" was not found.` };
    classes[index] = {
      ...classes[index]!,
      css: toClassRuleCss(name, cssText),
      source: "aria",
    };
    return classes;
  });
}

export function deleteClassPatch(
  snapshot: DesignSnapshot,
  nameRaw: string,
): DesignOpPatch | DesignOpFail {
  const name = sanitizeClassName(nameRaw);
  if (!name) return { ok: false, message: "Provide a class name." };
  return withClasses(snapshot, (classes) => {
    if (!classes.some((item) => item.name === name)) {
      return { ok: false, message: `Class "${name}" was not found.` };
    }
    return classes.filter((item) => item.name !== name);
  });
}

export function duplicateClassPatch(
  snapshot: DesignSnapshot,
  sourceNameRaw: string,
  newNameRaw?: string,
): DesignOpPatch | DesignOpFail {
  const sourceName = sanitizeClassName(sourceNameRaw);
  if (!sourceName) return { ok: false, message: "Provide a source class name." };
  return withClasses(snapshot, (classes) => {
    const source = classes.find((item) => item.name === sourceName);
    if (!source) return { ok: false, message: `Class "${sourceName}" was not found.` };
    const existing = new Set(classes.map((item) => item.name));
    const name = newNameRaw?.trim()
      ? sanitizeClassName(newNameRaw)
      : sequentialDuplicateName(sourceName, existing);
    if (!name || !isValidClassName(name)) {
      return { ok: false, message: "Provide a valid destination class name." };
    }
    if (existing.has(name)) {
      return { ok: false, message: `Class "${name}" already exists.` };
    }
    classes.push({ name, css: source.css, source: "aria" });
    return classes;
  });
}

export function manageCssVariablesPatch(
  snapshot: DesignSnapshot,
  input: {
    operation: "set_custom" | "unset_custom" | "set_alias" | "unset_alias";
    key: string;
    definition?: Partial<DesignVariableDefinition> & { value?: string; label?: string };
    alias?: Partial<DesignVariableAlias> & { label?: string; sourceType?: "token" | "custom"; sourceKey?: string };
  },
): DesignOpPatch | DesignOpFail {
  const key = input.key.trim().replace(/^--/, "");
  if (!key || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(key)) {
    return { ok: false, message: "Provide a valid CSS variable key (without leading --)." };
  }
  const variables: DesignVariables = {
    custom: { ...snapshot.variables.custom },
    aliases: { ...snapshot.variables.aliases },
  };

  if (input.operation === "set_custom") {
    const value = input.definition?.value?.trim();
    if (!value) return { ok: false, message: "set_custom requires definition.value." };
    const prior = variables.custom[key];
    variables.custom[key] = {
      label: input.definition?.label?.trim() || prior?.label || key,
      value,
      category: input.definition?.category ?? prior?.category ?? "other",
      source: "aria",
      description: input.definition?.description ?? prior?.description,
    };
    delete variables.aliases[key];
  } else if (input.operation === "unset_custom") {
    if (!(key in variables.custom)) {
      return { ok: false, message: `Custom variable "${key}" was not found.` };
    }
    delete variables.custom[key];
  } else if (input.operation === "set_alias") {
    const sourceType = input.alias?.sourceType;
    const sourceKey = input.alias?.sourceKey?.trim() ?? "";
    if (sourceType !== "token" && sourceType !== "custom") {
      return { ok: false, message: "set_alias requires alias.sourceType token|custom." };
    }
    const prior = variables.aliases[key];
    variables.aliases[key] = {
      label: input.alias?.label?.trim() || prior?.label || key,
      sourceType,
      sourceKey,
      fallback: input.alias?.fallback ?? prior?.fallback,
    };
    delete variables.custom[key];
  } else if (input.operation === "unset_alias") {
    if (!(key in variables.aliases)) {
      return { ok: false, message: `Alias "${key}" was not found.` };
    }
    delete variables.aliases[key];
  }

  return { ok: true, patch: { variables }, detail: { key, operation: input.operation } };
}

export function enableGoogleFontPatch(
  snapshot: DesignSnapshot,
  familyRaw: string,
  weights?: number[],
): DesignOpPatch | DesignOpFail {
  const family = familyRaw.trim();
  if (!family) return { ok: false, message: "Provide a Google font family name." };
  const fonts = cloneDesignFonts(snapshot.fonts);
  const key = family.toLowerCase();
  const existing = fonts.google.findIndex((font) => font.family.toLowerCase() === key);
  const next: DesignGoogleFont = {
    family,
    weights:
      weights && weights.length
        ? [...new Set(weights.filter((w) => Number.isFinite(w) && w > 0))].sort((a, b) => a - b)
        : existing >= 0
          ? fonts.google[existing]!.weights
          : [400, 700],
  };
  if (existing >= 0) fonts.google[existing] = next;
  else fonts.google.push(next);
  return { ok: true, patch: { fonts }, detail: { family: next.family, weights: next.weights } };
}

export function enableFontsourceFontPatch(
  snapshot: DesignSnapshot,
  input: { id?: string; family?: string; variable?: boolean },
): DesignOpPatch | DesignOpFail {
  const id = normalizeFontsourceId(input.id ?? input.family ?? "");
  if (!id) return { ok: false, message: "Provide a Fontsource font id." };
  const fonts = cloneDesignFonts(snapshot.fonts);
  const existing = fonts.fontsource.findIndex((font) => font.id === id);
  const family =
    input.family?.trim() ||
    fonts.fontsource[existing]?.family ||
    id
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const next: DesignFontsourceFont = {
    id,
    family,
    variable: Boolean(input.variable),
  };
  if (existing >= 0) fonts.fontsource[existing] = next;
  else fonts.fontsource.push(next);
  return {
    ok: true,
    patch: { fonts },
    detail: { id: next.id, family: next.family, variable: next.variable },
  };
}

export function disableFontPatch(
  snapshot: DesignSnapshot,
  familyRaw: string,
): DesignOpPatch | DesignOpFail {
  const family = familyRaw.trim();
  if (!family) return { ok: false, message: "Provide a font family name." };
  const key = family.toLowerCase();
  const idKey = normalizeFontsourceId(family);
  const fonts = cloneDesignFonts(snapshot.fonts, {
    google: snapshot.fonts.google.filter((font) => font.family.toLowerCase() !== key),
    custom: snapshot.fonts.custom.filter((font) => font.family.toLowerCase() !== key),
    fontsource: (snapshot.fonts.fontsource ?? []).filter(
      (font) => font.family.toLowerCase() !== key && font.id !== idKey,
    ),
    bodyFamily:
      snapshot.fonts.bodyFamily?.toLowerCase() === key ? undefined : snapshot.fonts.bodyFamily,
    headingFamily:
      snapshot.fonts.headingFamily?.toLowerCase() === key
        ? undefined
        : snapshot.fonts.headingFamily,
  });
  const removedGoogle = fonts.google.length !== snapshot.fonts.google.length;
  const removedCustom = fonts.custom.length !== snapshot.fonts.custom.length;
  const removedFontsource =
    fonts.fontsource.length !== (snapshot.fonts.fontsource ?? []).length;
  if (!removedGoogle && !removedCustom && !removedFontsource) {
    return { ok: false, message: `Font "${family}" is not enabled in the design system.` };
  }
  return {
    ok: true,
    patch: { fonts },
    detail: { family, removedGoogle, removedCustom, removedFontsource },
  };
}

export function deleteCustomFontMetaPatch(
  snapshot: DesignSnapshot,
  relativeFile: string,
): DesignOpPatch | DesignOpFail {
  const file = relativeFile.trim().replace(/\\/g, "/");
  if (!file) return { ok: false, message: "Provide a custom font relative file path." };
  const fonts = cloneDesignFonts(snapshot.fonts, {
    custom: snapshot.fonts.custom.filter((font) => font.file.replace(/\\/g, "/") !== file),
  });
  if (fonts.custom.length === snapshot.fonts.custom.length) {
    return { ok: false, message: `Custom font file "${file}" is not registered.` };
  }
  return { ok: true, patch: { fonts }, detail: { file } };
}

export function renameClassPatch(
  snapshot: DesignSnapshot,
  fromRaw: string,
  toRaw: string,
): DesignOpPatch | DesignOpFail {
  const from = sanitizeClassName(fromRaw);
  const to = sanitizeClassName(toRaw);
  if (!from || !to || !isValidClassName(to)) {
    return { ok: false, message: "Provide valid from/to CSS class names." };
  }
  if (from === to) return { ok: false, message: "from and to are identical." };
  return withClasses(snapshot, (classes) => {
    if (!classes.some((item) => item.name === from)) {
      return { ok: false, message: `Class "${from}" was not found.` };
    }
    if (classes.some((item) => item.name === to)) {
      return { ok: false, message: `Class "${to}" already exists.` };
    }
    return classes.map((item) =>
      item.name === from
        ? {
            ...item,
            name: to,
            css: item.css.replace(
              new RegExp(`\\.${from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[:\\s,{])`, "g"),
              `.${to}`,
            ),
            source: "aria" as const,
          }
        : item,
    );
  });
}

export function registerCustomFontPatch(
  snapshot: DesignSnapshot,
  font: { family: string; file: string },
): DesignOpPatch | DesignOpFail {
  const family = font.family.trim();
  const file = font.file.trim().replace(/\\/g, "/");
  if (!family || !file) {
    return { ok: false, message: "Provide family and file for the custom font." };
  }
  const fonts = cloneDesignFonts(snapshot.fonts, {
    custom: [
      ...snapshot.fonts.custom.filter((item) => item.file.replace(/\\/g, "/") !== file),
      { family, file },
    ],
  });
  return { ok: true, patch: { fonts }, detail: { family, file } };
}
