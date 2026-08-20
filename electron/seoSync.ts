import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { SiteSettings } from "../shared/types";
import {
  canonicalDirectory,
  removePathTracked,
  resolveWithinRoot,
  writeTextFileAtomic,
} from "./pathSafety";
import {
  syncSeoInjection,
  SEO_WIRED_MARKER,
  findExistingMiddleware,
} from "./seoInjection";
import {
  syncDiscoveryArtifacts,
  removeManagedDiscoveryArtifacts,
  DISCOVERY_MARKER,
} from "./discoveryInjection";

const MANAGED_ROOT_MARKER = "@aria-managed-document";
const LEGACY_MANAGED_ROOT_MARKER = "@aria-managed-snippets";
const SNIPPETS_WIRED_MARKER = "aria/snippets-middleware";
export const REDIRECTS_WIRED_MARKER = "aria/redirects-middleware";

const SEO_IMPORT_RE =
  /import\s*\{\s*onRequest\s+as\s+ariaSeoOnRequest\s*\}\s*from\s*["']\.\/aria\/seo-middleware["'];?\n?/;
const REDIRECTS_IMPORT_RE =
  /import\s*\{\s*onRequest\s+as\s+ariaRedirectsOnRequest\s*\}\s*from\s*["']\.\/aria\/redirects-middleware["'];?\n?/;

function projectFile(root: string, relativePosixOrNative: string): string {
  return resolveWithinRoot(
    root,
    path.join(root, ...relativePosixOrNative.split(/[/\\]/).filter(Boolean)),
    { allowMissing: true, rejectFinalSymlink: true },
  );
}

/**
 * Single owner of src/middleware.ts sequence:
 * redirects (always) → SEO? (managed) → snippets (always) → user?
 */
function buildManagedRootMiddlewareSource(includeSeo: boolean): string {
  const imports = [
    `import { sequence } from "astro:middleware";`,
    `import { onRequest as ariaRedirectsOnRequest } from "./aria/redirects-middleware";`,
    `import { onRequest as ariaSnippetsOnRequest } from "./aria/snippets-middleware";`,
  ];
  if (includeSeo) {
    imports.push(
      `import { onRequest as ariaSeoOnRequest } from "./aria/seo-middleware";`,
    );
  }
  const sequenceArgs = includeSeo
    ? "ariaRedirectsOnRequest, ariaSeoOnRequest, ariaSnippetsOnRequest"
    : "ariaRedirectsOnRequest, ariaSnippetsOnRequest";

  return [
    `/**`,
    ` * ${MANAGED_ROOT_MARKER}`,
    ` * Aria-managed Astro middleware — wires redirects, document SEO, and snippets.`,
    ` * Safe to keep; add your own handlers via sequence if needed.`,
    ` */`,
    ...imports,
    ``,
    `export const onRequest = sequence(${sequenceArgs});`,
    ``,
  ].join("\n");
}

function isAriaManagedRoot(source: string): boolean {
  return (
    source.includes(MANAGED_ROOT_MARKER) ||
    source.includes(LEGACY_MANAGED_ROOT_MARKER)
  );
}

function isAlreadyWiredFor(source: string, marker: string): boolean {
  return source.includes(marker);
}

function ensureRedirectsImport(source: string): string {
  if (
    REDIRECTS_IMPORT_RE.test(source) ||
    source.includes(REDIRECTS_WIRED_MARKER)
  ) {
    return source;
  }
  if (source.includes(SNIPPETS_WIRED_MARKER)) {
    return source.replace(
      /(import\s*\{\s*onRequest\s+as\s+ariaSnippetsOnRequest\s*\}\s*from\s*["']\.\/aria\/snippets-middleware["'];?\n?)/,
      `import { onRequest as ariaRedirectsOnRequest } from "./aria/redirects-middleware";\n$1`,
    );
  }
  return (
    `import { onRequest as ariaRedirectsOnRequest } from "./aria/redirects-middleware";\n` +
    source
  );
}

/**
 * Ensure redirects is first in sequence(...) for user-owned middleware wraps.
 */
function injectRedirectsIntoExistingSequence(source: string): string {
  let next = ensureRedirectsImport(source);

  if (!/\bariaRedirectsOnRequest\b/.test(next)) {
    return next;
  }

  if (/sequence\s*\(\s*ariaRedirectsOnRequest\b/.test(next)) {
    return next;
  }

  next = next.replace(
    /sequence\s*\(\s*((?:ariaRedirectsOnRequest\s*,\s*)?)ariaSeoOnRequest/,
    (_match, already: string) =>
      already
        ? `sequence(${already}ariaSeoOnRequest`
        : `sequence(ariaRedirectsOnRequest, ariaSeoOnRequest`,
  );

  next = next.replace(
    /sequence\s*\(\s*((?:ariaRedirectsOnRequest\s*,\s*)?)ariaSnippetsOnRequest/,
    (_match, already: string) =>
      already
        ? `sequence(${already}ariaSnippetsOnRequest`
        : `sequence(ariaRedirectsOnRequest, ariaSnippetsOnRequest`,
  );

  if (
    isAlreadyWiredFor(next, SNIPPETS_WIRED_MARKER) &&
    !isAlreadyWiredFor(next, REDIRECTS_WIRED_MARKER)
  ) {
    next = next.replace(
      /sequence\s*\(\s*(?!ariaRedirectsOnRequest)/,
      "sequence(ariaRedirectsOnRequest, ",
    );
  }

  return next;
}

function injectSeoIntoExistingSequence(source: string): string {
  let next = injectRedirectsIntoExistingSequence(source);

  if (!SEO_IMPORT_RE.test(next) && !next.includes(SEO_WIRED_MARKER)) {
    if (next.includes(SNIPPETS_WIRED_MARKER)) {
      next = next.replace(
        /(import\s*\{\s*onRequest\s+as\s+ariaSnippetsOnRequest\s*\}\s*from\s*["']\.\/aria\/snippets-middleware["'];?\n?)/,
        `$1import { onRequest as ariaSeoOnRequest } from "./aria/seo-middleware";\n`,
      );
    } else {
      next =
        `import { onRequest as ariaSeoOnRequest } from "./aria/seo-middleware";\n` +
        next;
    }
  }

  next = next.replace(
    /sequence\s*\(\s*ariaRedirectsOnRequest\s*,\s*((?:ariaSeoOnRequest\s*,\s*)?)ariaSnippetsOnRequest/,
    (_match, alreadySeo: string) =>
      alreadySeo
        ? `sequence(ariaRedirectsOnRequest, ${alreadySeo}ariaSnippetsOnRequest`
        : `sequence(ariaRedirectsOnRequest, ariaSeoOnRequest, ariaSnippetsOnRequest`,
  );

  next = next.replace(
    /sequence\s*\(\s*((?:ariaSeoOnRequest\s*,\s*)?)ariaSnippetsOnRequest/,
    (match, alreadySeo: string) => {
      if (match.includes("ariaRedirectsOnRequest")) return match;
      return alreadySeo
        ? `sequence(ariaRedirectsOnRequest, ${alreadySeo}ariaSnippetsOnRequest`
        : `sequence(ariaRedirectsOnRequest, ariaSeoOnRequest, ariaSnippetsOnRequest`;
    },
  );

  if (
    isAlreadyWiredFor(next, SNIPPETS_WIRED_MARKER) &&
    !isAlreadyWiredFor(next, SEO_WIRED_MARKER)
  ) {
    next = next.replace(
      /sequence\s*\(\s*ariaRedirectsOnRequest\s*,\s*(?!ariaSeoOnRequest)/,
      "sequence(ariaRedirectsOnRequest, ariaSeoOnRequest, ",
    );
  }

  return next;
}

function removeSeoFromSequence(source: string): string {
  let next = source.replace(SEO_IMPORT_RE, "");
  next = next.replace(/ariaSeoOnRequest\s*,\s*/g, "");
  next = next.replace(/,\s*ariaSeoOnRequest/g, "");
  return injectRedirectsIntoExistingSequence(next);
}

function wrapUserMiddleware(source: string, includeSeo: boolean): string {
  if (!/export\s+const\s+onRequest\b/.test(source)) {
    throw new Error(
      "Cannot wire Aria middleware: src/middleware.* must export `const onRequest` " +
        "(or let Aria create the file).",
    );
  }

  const withoutExport = source.replace(
    /export\s+const\s+onRequest\b/,
    "const __ariaUserOnRequest",
  );

  const importLines = [
    `import { sequence } from "astro:middleware";`,
    `import { onRequest as ariaRedirectsOnRequest } from "./aria/redirects-middleware";`,
    `import { onRequest as ariaSnippetsOnRequest } from "./aria/snippets-middleware";`,
  ];
  if (includeSeo) {
    importLines.push(
      `import { onRequest as ariaSeoOnRequest } from "./aria/seo-middleware";`,
    );
  }

  const handlers = includeSeo
    ? "ariaRedirectsOnRequest, ariaSeoOnRequest, ariaSnippetsOnRequest, __ariaUserOnRequest"
    : "ariaRedirectsOnRequest, ariaSnippetsOnRequest, __ariaUserOnRequest";

  return (
    importLines.join("\n") +
    "\n" +
    withoutExport.replace(/\s*$/, "\n") +
    `\nexport const onRequest = sequence(${handlers});\n`
  );
}

/**
 * Ensure root middleware sequences redirects + SEO (when managed) + snippets.
 * Sole writer of Aria-managed src/middleware.ts — snippetsInjection must not rewrite root.
 */
export function unifyAriaMiddleware(
  projectPath: string,
  siteSettings: SiteSettings,
): void {
  const root = canonicalDirectory(projectPath);
  const includeSeo = siteSettings.seoManagement?.status === "managed";
  const existing = findExistingMiddleware(root);

  if (!existing) {
    const target = projectFile(root, path.join("src", "middleware.ts"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeTextFileAtomic(target, buildManagedRootMiddlewareSource(includeSeo));
    return;
  }

  const current = readFileSync(existing, "utf8");

  if (isAriaManagedRoot(current)) {
    writeTextFileAtomic(existing, buildManagedRootMiddlewareSource(includeSeo));
    return;
  }

  const hasSnippets = isAlreadyWiredFor(current, SNIPPETS_WIRED_MARKER);
  const hasSeo = isAlreadyWiredFor(current, SEO_WIRED_MARKER);
  const hasRedirects = isAlreadyWiredFor(current, REDIRECTS_WIRED_MARKER);

  if (hasSnippets && hasSeo === includeSeo && hasRedirects) return;

  if (hasSnippets) {
    let next = includeSeo
      ? injectSeoIntoExistingSequence(current)
      : removeSeoFromSequence(current);
    next = injectRedirectsIntoExistingSequence(next);
    if (next !== current) {
      writeTextFileAtomic(existing, next);
    }
    return;
  }

  if (!includeSeo && !hasSnippets) {
    return;
  }

  const patched = wrapUserMiddleware(current, includeSeo);
  writeTextFileAtomic(existing, patched);
}

function removeSeoMiddlewareModule(root: string): void {
  const target = projectFile(root, path.join("src", "aria", "seo-middleware.ts"));
  const generated = projectFile(
    root,
    path.join("src", "aria", "seo.generated.ts"),
  );
  for (const file of [target, generated]) {
    if (!existsSync(file)) continue;
    try {
      const body = readFileSync(file, "utf8");
      if (
        body.includes("@aria-seo-middleware") ||
        body.includes("Aria-generated SEO")
      ) {
        removePathTracked(file, { force: true });
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * Sync or tear down SEO/discovery bake based on management status.
 * Always re-unifies root so redirects stay first in sequence.
 */
export function syncManagedSeoAndDiscovery(
  projectPath: string,
  siteSettings: SiteSettings,
): void {
  const root = canonicalDirectory(projectPath);
  const managed = siteSettings.seoManagement?.status === "managed";

  void (async () => {
    if (managed) {
      await syncSeoInjection(root, siteSettings);
      await syncDiscoveryArtifacts(root, siteSettings);
      unifyAriaMiddleware(root, siteSettings);
      return;
    }

    unifyAriaMiddleware(root, siteSettings);
    removeManagedDiscoveryArtifacts(root);
    removeSeoMiddlewareModule(root);
  })().catch((error) => {
    console.error("[aria] SEO/discovery sync failed:", error);
  });
}

export { DISCOVERY_MARKER };
