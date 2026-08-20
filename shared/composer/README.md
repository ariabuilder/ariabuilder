# Composer Astro kernel (Phase 0)

Parse / serialize editable `.astro` documents for Aria Composer.

- **SoT:** disk `.astro` only — never `.aria/composer/*.json`
- **Parser:** `@astrojs/compiler` `parse()` (not a regex scanner)
- **API:** `parseAstro` · `serializeAstro` · `serializeAstroMarked` · `extractPropSchema`
- **Markers:** `data-aria-s` / `data-aria-e` (dev-only; never written by `serializeAstro`)

See [BAIL_TAXONOMY.md](./BAIL_TAXONOMY.md) and [BRIDGE.md](./BRIDGE.md).
