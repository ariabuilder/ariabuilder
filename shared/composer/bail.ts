/**
 * Bail taxonomy for Composer Astro parse.
 *
 * Policy: prefer opaque `expr` / `raw` nodes for hard regions over whole-file
 * bail. Whole-file bail is reserved for cases where we cannot guarantee a
 * non-destructive round-trip.
 *
 * See also BAIL_TAXONOMY.md.
 */

import type { BailDetail, BailReasonCode } from "./types";

export const BAIL_TAXONOMY: Record<
  BailReasonCode,
  { title: string; when: string; recovery: string }
> = {
  compiler_error: {
    title: "Unrecoverable compiler error",
    when: "@astrojs/compiler reports DiagnosticSeverity.Error (or parse throws).",
    recovery: "Open in code editor; fix syntax; re-parse.",
  },
  markdown_mdx: {
    title: "Markdown / MDX page",
    when: "Filename ends in .md or .mdx (policy: code editor until MDX track).",
    recovery: "Edit as code, or convert content to .astro when visual edit is needed.",
  },
  unsafe_rewrite: {
    title: "Unsafe rewrite construct",
    when:
      "A construct is explicitly marked as unsafe to rewrite (reserved; currently unused — hard regions become opaque nodes instead).",
    recovery: "Code editor; optionally extract region into a child .astro component.",
  },
  parse_exception: {
    title: "Parser exception",
    when: "Unexpected throw while mapping compiler AST → editable model.",
    recovery: "Treat as code; file a corpus fixture if reproducible.",
  },
};

/** Constructs that stay editable as opaque units (NOT whole-file bail). */
export const OPAQUE_NOT_BAIL = [
  "Complex `{…}` expressions that are not map/&&/ternary template shapes",
  "Attribute spreads `{...props}` (stored as spread prop values)",
  "Deeply nested attribute expressions",
  "Inline `<script>` / `<style>` bodies (raw nodes)",
  "Dynamic tags (capitalized, not imported)",
  "HTML `?raw` imports until chunk files are resolved (Fragment remains editable)",
] as const;

export function formatBailReason(detail: BailDetail): string {
  const base = BAIL_TAXONOMY[detail.code]?.title ?? "Not visually editable";
  const near = detail.near ? ` Near: ${detail.near.slice(0, 80)}` : "";
  const line = detail.line ? ` (line ${detail.line})` : "";
  return `${base}: ${detail.what}.${line}${near}`.trim();
}
