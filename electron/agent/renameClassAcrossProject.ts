/**
 * Rename a Design Manager class and rewrite project class references.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { parseAstro } from "../../shared/composer/parseAstro";
import {
  renameClassReferences,
  renameClassRuleCss,
} from "../../shared/composer/renameClassReferences";
import type { AstroDocumentModel } from "../../shared/composer/types";
import { patchComposerModelSource } from "../../shared/composer/sourcePatches";
import { getDesignSnapshot, scanClassUsage } from "../design";
import { commitComposerEditTransaction } from "../composer/transaction";
import { canonicalDirectory } from "../pathSafety";
import { hashRevision } from "../../shared/agent/revision";

const SKIP_DIRS = new Set(["node_modules", ".git", ".astro", "dist", ".aria"]);

function toPosix(value: string): string {
  return value.split(/[\\/]/).join("/");
}

function snapshotRevision(state: unknown, prefix = "d"): string {
  if (
    prefix === "d" &&
    state &&
    typeof state === "object" &&
    typeof (state as { revision?: unknown }).revision === "string"
  ) {
    return (state as { revision: string }).revision;
  }
  return hashRevision(state, prefix);
}

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 40 || !existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkFiles(absolute, out, depth + 1);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (ext === ".astro" || ext === ".css") out.push(absolute);
  }
}

function rewriteLooseClassAttributes(source: string, from: string, to: string): string {
  const token = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return source
    .replace(
      /(class(?:Name)?\s*=\s*)(["'`])([^"'`]*?)\2/g,
      (full, prefix: string, quote: string, body: string) => {
        const next = body
          .split(/\s+/)
          .map((part) => (part === from ? to : part))
          .join(" ");
        if (next === body) return full;
        return `${prefix}${quote}${next}${quote}`;
      },
    )
    .replace(new RegExp(`\\.${token}(?=[:\\s,{])`, "g"), `.${to}`);
}

export async function renameClassAcrossProject(input: {
  projectPath: string;
  from: string;
  to: string;
  expectedRevision: string;
  dryRun?: boolean;
}): Promise<
  | {
      ok: true;
      dryRun: boolean;
      from: string;
      to: string;
      revision?: string;
      usageBefore: Record<string, number>;
      rewrittenFiles: string[];
      designRenamed: boolean;
    }
  | {
      ok: false;
      code: "CONFLICT" | "INVALID_INPUT";
      message: string;
      currentVersion?: string;
    }
> {
  const current = getDesignSnapshot(input.projectPath);
  const currentRevision = snapshotRevision(current, "d");
  if (currentRevision !== input.expectedRevision) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "The design system changed since it was read.",
      currentVersion: currentRevision,
    };
  }

  const from = input.from.trim().replace(/^\./, "");
  const to = input.to.trim().replace(/^\./, "");
  if (!/^[a-zA-Z_][\w-]*$/.test(to) || to.length > 64) {
    return { ok: false, code: "INVALID_INPUT", message: "Provide a valid CSS class name." };
  }
  const root = canonicalDirectory(input.projectPath);
  const files: string[] = [];
  for (const rel of ["src", "styles"]) {
    walkFiles(path.join(root, rel), files);
  }
  const hasSelector = (name: string) => {
    const token = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selector = new RegExp(`\\.${token}(?=[:\\s,{])`);
    return files.some((file) => {
      try { return selector.test(readFileSync(file, "utf8")); } catch { return false; }
    });
  };
  const sourceClass = current.classes.find((item) => item.name === from);
  if (!sourceClass && !hasSelector(from)) {
    return { ok: false, code: "INVALID_INPUT", message: `Class "${from}" was not found.` };
  }
  if (from === to || current.classes.some((item) => item.name === to) || hasSelector(to)) {
    return { ok: false, code: "INVALID_INPUT", message: from === to ? "The class names are identical." : `Class "${to}" already exists.` };
  }

  const usageBefore = scanClassUsage(input.projectPath, [from]);

  const rewrittenFiles: string[] = [];
  const cssEdits: Array<{ relativeFile: string; content: string; expectedMtimeMs: number }> =
    [];
  const sourceEdits: Array<{ relativeFile: string; source: string; expectedSource: string; expectedMtimeMs: number }> = [];

  for (const absolute of files) {
    const relativeFile = toPosix(path.relative(root, absolute));
    const ext = path.extname(absolute).toLowerCase();
    const before = readFileSync(absolute, "utf8");
    const expectedMtimeMs = Math.floor(statSync(absolute).mtimeMs);

    if (ext === ".astro") {
      const parsed = await parseAstro(before, { filename: absolute });
      if (!parsed.editable) {
        const next = rewriteLooseClassAttributes(before, from, to);
        if (next !== before) {
          rewrittenFiles.push(relativeFile);
          sourceEdits.push({ relativeFile, source: next, expectedSource: before, expectedMtimeMs });
        }
        continue;
      }
      const beforeModel = structuredClone(parsed.model) as AstroDocumentModel;
      const changed = renameClassReferences(parsed.model.nodes, from, to);
      if (changed > 0) {
        const patched = patchComposerModelSource(before, beforeModel, parsed.model);
        if (!patched.ok) {
          return {
            ok: false,
            code: "INVALID_INPUT",
            message: `${relativeFile}: ${patched.reason}`,
          };
        }
        rewrittenFiles.push(relativeFile);
        sourceEdits.push({
          relativeFile,
          source: patched.source,
          expectedSource: before,
          expectedMtimeMs,
        });
      } else {
        const loose = rewriteLooseClassAttributes(before, from, to);
        if (loose !== before) {
          rewrittenFiles.push(relativeFile);
          sourceEdits.push({ relativeFile, source: loose, expectedSource: before, expectedMtimeMs });
        }
      }
      continue;
    }

    const withSelectors = renameClassRuleCss(before, from, to);
    if (withSelectors !== before) {
      rewrittenFiles.push(relativeFile);
      cssEdits.push({
        relativeFile,
        content: withSelectors,
        expectedMtimeMs,
      });
    }
  }

  if (input.dryRun) {
    return {
      ok: true,
      dryRun: true,
      from,
      to,
      usageBefore,
      rewrittenFiles,
      designRenamed: sourceClass?.source === "aria",
    };
  }

  if (sourceEdits.length || cssEdits.length) {
    const committed = commitComposerEditTransaction({
      projectPath: input.projectPath,
      sources: sourceEdits,
      stylesheets: cssEdits,
    });
    if (!committed.ok) {
      return {
        ok: false,
        code: "CONFLICT",
        message: committed.message,
        currentVersion: String(committed.conflicts[0]?.mtimeMs ?? ""),
      };
    }
  }

  const nextDesign = getDesignSnapshot(input.projectPath);
  return {
    ok: true,
    dryRun: false,
    from,
    to,
    revision: snapshotRevision(nextDesign, "d"),
    usageBefore,
    rewrittenFiles,
    designRenamed: sourceClass?.source === "aria",
  };
}
