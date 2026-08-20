import type { ComponentControlMetadata } from "./types";
import { isConditionSet, validateComponentControlMetadata } from "./validate";

const METADATA_PATTERN = /\/\*\s*@aria-component-controls\s+v1\s*\n([\s\S]*?)\n\s*\*\//;

export type ParsedComponentControlMetadata = {
  metadata: ComponentControlMetadata;
  found: boolean;
  valid: boolean;
  error?: string;
};

export function emptyComponentControlMetadata(): ComponentControlMetadata {
  return { version: 1, fields: {} };
}

export function parseComponentControlMetadata(source: string): ParsedComponentControlMetadata {
  const match = METADATA_PATTERN.exec(source);
  if (!match) return { metadata: emptyComponentControlMetadata(), found: false, valid: true };
  try {
    const value = JSON.parse(match[1]!) as Partial<ComponentControlMetadata>;
    if (value.version !== 1 || !value.fields || typeof value.fields !== "object" || Array.isArray(value.fields)) {
      throw new Error("Use version 1 with a fields object.");
    }
    const metadata: ComponentControlMetadata = { version: 1, fields: {} };
    for (const [field, control] of Object.entries(value.fields)) {
      if (!control || typeof control !== "object" || Array.isArray(control)) throw new Error(`Invalid controls for ${field}.`);
      const candidate = control as Record<string, unknown>;
      if (candidate.visibleWhen !== undefined && !isConditionSet(candidate.visibleWhen)) throw new Error(`Invalid visibility rule for ${field}.`);
      if (candidate.enabledWhen !== undefined && !isConditionSet(candidate.enabledWhen)) throw new Error(`Invalid enabled rule for ${field}.`);
      metadata.fields[field] = {
        visibleWhen: candidate.visibleWhen,
        enabledWhen: candidate.enabledWhen,
      };
    }
    const issues = validateComponentControlMetadata(metadata);
    if (issues.length) throw new Error(issues[0]!.message);
    return { metadata, found: true, valid: true };
  } catch (error) {
    return {
      metadata: emptyComponentControlMetadata(),
      found: true,
      valid: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function writeComponentControlMetadata(
  source: string,
  metadata: ComponentControlMetadata,
): string {
  const issues = validateComponentControlMetadata(metadata);
  if (issues.length) throw new Error(issues[0]!.message);
  const normalizedFields = Object.fromEntries(Object.entries(metadata.fields).filter(([, value]) => value.visibleWhen || value.enabledWhen));
  const normalized: ComponentControlMetadata = { version: 1, fields: normalizedFields };
  const block = `/* @aria-component-controls v1\n${JSON.stringify(normalized, null, 2)}\n*/`;
  if (METADATA_PATTERN.test(source)) return source.replace(METADATA_PATTERN, block);
  const frontmatter = /^(\uFEFF?---\s*\r?\n)([\s\S]*?)(\r?\n---)/.exec(source);
  if (!frontmatter) throw new Error("Component control metadata requires Astro frontmatter.");
  const body = frontmatter[2]!.trimEnd();
  const nextBody = body ? `${body}\n\n${block}` : block;
  return `${frontmatter[1]}${nextBody}${frontmatter[3]}${source.slice(frontmatter[0].length)}`;
}

