/**
 * Import-path helpers for inserting project components into a page.
 * Both `pageFile` and `componentFile` are project-relative posix paths
 * (e.g. `src/pages/index.astro`, `src/components/Card.astro`).
 */

import type { AstroDocumentModel } from "./types";

export type ImportPathOptions = {
  /** Relative from the page directory (`../components/Card.astro`). */
  relative: string;
  /** Path under `src/` when the target lives there (`components/Card.astro`). */
  srcRelative: string | null;
};

function dirnamePosix(file: string): string {
  const normalized = file.replace(/\\/g, "/");
  const i = normalized.lastIndexOf("/");
  return i <= 0 ? "" : normalized.slice(0, i);
}

function relativePosix(fromDir: string, toFile: string): string {
  const from = fromDir.replace(/\\/g, "/").split("/").filter(Boolean);
  const toParts = toFile.replace(/\\/g, "/").split("/").filter(Boolean);
  const toName = toParts.pop()!;
  let i = 0;
  while (
    i < from.length &&
    i < toParts.length &&
    from[i] === toParts[i]
  ) {
    i += 1;
  }
  const ups = from.length - i;
  const down = toParts.slice(i);
  const parts = [...Array(ups).fill(".."), ...down, toName];
  const rel = parts.join("/");
  return rel.startsWith(".") ? rel : `./${rel}`;
}

/** Compute relative + optional src-relative import specs for a component file. */
export function importPathsFor(
  pageFile: string,
  componentFile: string,
): ImportPathOptions {
  const page = pageFile.replace(/\\/g, "/");
  const target = componentFile.replace(/\\/g, "/");
  const relative = relativePosix(dirnamePosix(page), target);
  let srcRelative: string | null = null;
  if (target.startsWith("src/")) {
    srcRelative = target.slice("src/".length);
  }
  return { relative, srcRelative };
}

/**
 * Prefer an existing alias style (`@/components/…`) when the page already
 * imports that way; otherwise use a relative path.
 */
export function chooseImportPath(
  model: AstroDocumentModel,
  paths: ImportPathOptions,
): string {
  if (paths.srcRelative) {
    for (const imp of model.imports) {
      if (imp.path.startsWith(".")) continue;
      for (const marker of ["/components/", "/layouts/"]) {
        const idx = imp.path.indexOf(marker);
        if (idx > 0) {
          return `${imp.path.slice(0, idx + 1)}${paths.srcRelative}`;
        }
      }
    }
  }
  return paths.relative;
}
