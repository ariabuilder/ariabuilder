/**
 * Resolve an Astro import to a project file and extract its prop schema.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { extractPropSchema } from "../../shared/composer/props";
import type { PropField } from "../../shared/composer/types";
import { resolveWithinRoot } from "../pathSafety";
import { resolveComposerPageFile } from "./parsePage";

export type ComposerPropSchemaResult = {
  fields: PropField[];
  extendsTag: string | null;
  slots: string[];
  hasRest: boolean;
  /** Project-relative posix path when resolved. */
  relativeFile: string | null;
  resolved: boolean;
  mtimeMs: number | null;
  controlMetadataFound?: boolean;
  controlMetadataValid?: boolean;
  controlMetadataError?: string;
};

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function findSrcRoot(fromFile: string): string | null {
  let current = path.dirname(fromFile);
  for (let i = 0; i < 12; i++) {
    if (path.basename(current) === "src") return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

function resolveFileCandidate(root: string, absolute: string): string | null {
  const candidates: string[] = [absolute];
  if (!path.extname(absolute)) {
    for (const ext of [".astro", ".ts", ".js", ".tsx", ".jsx", ".mjs"]) {
      candidates.push(absolute + ext);
    }
    for (const ext of [".astro", ".ts", ".js"]) {
      candidates.push(path.join(absolute, `index${ext}`));
    }
  }

  for (const candidate of candidates) {
    try {
      const safe = resolveWithinRoot(root, candidate, {
        rejectFinalSymlink: true,
      });
      if (statSync(safe).isFile()) return path.resolve(candidate);
    } catch {
      // Missing, outside the project, or a final symlink: try the next candidate.
    }
  }
  return null;
}

function compilerOptionsForProject(root: string): ts.CompilerOptions | null {
  const tsconfig = path.join(root, "tsconfig.json");
  const jsconfig = path.join(root, "jsconfig.json");
  const configPath = existsSync(tsconfig)
    ? tsconfig
    : existsSync(jsconfig)
      ? jsconfig
      : null;
  if (!configPath) return null;

  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) return null;

  return ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    path.dirname(configPath),
  ).options;
}

function configuredPathCandidates(root: string, importSpec: string): string[] {
  const options = compilerOptionsForProject(root);
  const mappings = options?.paths;
  if (!mappings) return [];

  const pathsBasePath =
    typeof options.pathsBasePath === "string" ? options.pathsBasePath : null;
  const base = options.baseUrl ?? pathsBasePath ?? root;
  const matches: Array<{
    key: string;
    capture: string;
    exact: boolean;
    prefixLength: number;
    suffixLength: number;
  }> = [];

  for (const key of Object.keys(mappings)) {
    const star = key.indexOf("*");
    if (star < 0) {
      if (key === importSpec) {
        matches.push({
          key,
          capture: "",
          exact: true,
          prefixLength: key.length,
          suffixLength: 0,
        });
      }
      continue;
    }

    const prefix = key.slice(0, star);
    const suffix = key.slice(star + 1);
    if (
      !importSpec.startsWith(prefix) ||
      !importSpec.endsWith(suffix) ||
      importSpec.length < prefix.length + suffix.length
    ) {
      continue;
    }
    matches.push({
      key,
      capture: importSpec.slice(
        prefix.length,
        importSpec.length - suffix.length,
      ),
      exact: false,
      prefixLength: prefix.length,
      suffixLength: suffix.length,
    });
  }

  matches.sort(
    (a, b) =>
      Number(b.exact) - Number(a.exact) ||
      b.prefixLength - a.prefixLength ||
      b.suffixLength - a.suffixLength ||
      a.key.localeCompare(b.key),
  );

  const match = matches[0];
  if (!match) return [];

  const candidates: string[] = [];
  for (const target of mappings[match.key] ?? []) {
    const substituted = target.includes("*")
      ? target.replaceAll("*", match.capture)
      : target;
    candidates.push(path.resolve(base, substituted));
  }
  return candidates;
}

/**
 * Resolve a relative, configured path-alias, `@/`, or `~/` import to an
 * absolute file under the project (extensionless candidates tried like a
 * bundler).
 */
export function resolveAstroImport(
  projectPath: string,
  fromAbsoluteFile: string,
  importSpec: string,
): string | null {
  const root = path.resolve(projectPath);
  const cleaned = importSpec.replace(/[?#].*$/, "").trim();
  if (!cleaned) return null;

  const configured = configuredPathCandidates(root, cleaned);
  const candidates: string[] = [];
  if (cleaned.startsWith(".")) {
    candidates.push(path.resolve(path.dirname(fromAbsoluteFile), cleaned));
  } else if (cleaned.startsWith("/")) {
    // Project-root absolute (rare in Astro sources).
    candidates.push(path.resolve(root, cleaned.replace(/^\/+/, "")));
  } else {
    candidates.push(...configured);
    if (cleaned.startsWith("@/")) {
      const srcRoot = findSrcRoot(fromAbsoluteFile) ?? path.join(root, "src");
      candidates.push(path.resolve(srcRoot, cleaned.slice(2)));
    } else if (cleaned.startsWith("~/")) {
      candidates.push(path.resolve(root, cleaned.slice(2)));
    }
  }

  for (const candidate of candidates) {
    const resolved = resolveFileCandidate(root, candidate);
    if (resolved) return resolved;
  }
  return null;
}

export type ComposerExtractPropSchemaInput = {
  projectPath: string;
  /** Page/layout/component that owns the import (project-relative). */
  fromRelativeFile: string;
  /** Import specifier from the model (`../components/Card.astro`, `@/…`). */
  importSpec: string;
};

export function extractComposerPropSchema(
  input: ComposerExtractPropSchemaInput,
): ComposerPropSchemaResult {
  const empty: ComposerPropSchemaResult = {
    fields: [],
    extendsTag: null,
    slots: [],
    hasRest: false,
    relativeFile: null,
    resolved: false,
    mtimeMs: null,
  };

  let fromAbs: string;
  try {
    fromAbs = resolveComposerPageFile(
      input.projectPath,
      input.fromRelativeFile,
    );
  } catch {
    // Allow extracting from non-page .astro (components) via the same rules.
    const root = path.resolve(input.projectPath);
    const rel = input.fromRelativeFile.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!rel || rel.split("/").includes("..") || !/\.astro$/i.test(rel)) {
      return empty;
    }
    fromAbs = path.resolve(root, rel);
    try {
      fromAbs = resolveWithinRoot(root, fromAbs, {
        rejectFinalSymlink: true,
      });
    } catch {
      return empty;
    }
    if (!existsSync(fromAbs)) return empty;
  }

  const resolved = resolveAstroImport(
    input.projectPath,
    fromAbs,
    input.importSpec,
  );
  if (!resolved || !/\.astro$/i.test(resolved)) {
    return empty;
  }

  const root = path.resolve(input.projectPath);
  const relativeFile = toPosix(path.relative(root, resolved));
  try {
    const source = readFileSync(resolved, "utf8");
    const schema = extractPropSchema(source);
    return {
      fields: schema.fields,
      extendsTag: schema.extendsTag,
      slots: schema.slots,
      hasRest: schema.hasRest,
      relativeFile,
      resolved: true,
      mtimeMs: Math.floor(statSync(resolved).mtimeMs),
      controlMetadataFound: schema.controlMetadataFound,
      controlMetadataValid: schema.controlMetadataValid,
      controlMetadataError: schema.controlMetadataError,
    };
  } catch {
    return {
      ...empty,
      relativeFile,
      resolved: true,
    };
  }
}
