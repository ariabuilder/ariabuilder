# Composer bail taxonomy

Whole-file bail (`editable: false`) is **rare by design**. Prefer opaque `expr` / `raw` nodes so the rest of the page stays visually editable.

## Whole-file bail codes

| Code | When | Recovery |
|---|---|---|
| `compiler_error` | `@astrojs/compiler` reports `DiagnosticSeverity.Error`, or parse cannot produce a usable AST | Fix syntax in code editor |
| `markdown_mdx` | Filename ends in `.md` / `.mdx` (policy until MDX track) | Edit as code, or convert to `.astro` |
| `unsafe_rewrite` | Reserved for constructs we refuse to rewrite (currently unused — hard regions become opaque) | Code editor / extract component |
| `parse_exception` | Unexpected throw while mapping AST → model | Code editor; add corpus fixture |

## Opaque (editable as a unit — not bail)

- Complex `{…}` expressions that are not map / `&&` / ternary template shapes
- Attribute spreads `{...props}`
- Deeply nested attribute expressions
- Inline `<script>` / `<style>` bodies (`raw` nodes)
- Dynamic tags (capitalized, not imported)
- HTML `?raw` chunks until files are resolved (Fragment remains in the tree)

## Formatting contract

`serializeAstro` uses a stable pretty printer. Round-trip is **semantic**, not byte-identical whitespace. Golden fixtures lock intentional formatting.

## Explicit non-SoT

`.aria/composer/*.json` DSL sidecars must **not** be introduced as document source of truth. Disk `.astro` is the only SoT.
