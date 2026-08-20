/**
 * Standalone entry for the ephemeral Vite marker plugin.
 * Built to `dist-electron/composer-kernel.mjs` and copied into
 * `node_modules/.aria/kernel.mjs` so the project's `astro dev` can import it.
 *
 * `@astrojs/compiler` stays external — `writeMarkerConfig` vendors a copy under
 * `node_modules/.aria/node_modules/@astrojs/compiler` (WASM + pnpm-safe resolve).
 */

export { parseAstro } from "../../shared/composer/parseAstro";
export { serializeAstroMarked } from "../../shared/composer/serializeAstro";
export { resolveRawChunks } from "../../shared/composer/rawChunks";
