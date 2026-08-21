import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const outdir = path.join(root, "dist-electron");
const composerKernelOnly = process.argv.includes("--composer-kernel-only");

if (!composerKernelOnly) {
  fs.rmSync(outdir, { recursive: true, force: true });
}
fs.mkdirSync(outdir, { recursive: true });

if (!composerKernelOnly) {
  await esbuild.build({
    entryPoints: {
      main: path.join(root, "electron/main.ts"),
      "translation-catalog-worker": path.join(root, "electron/translationCatalogWorker.ts"),
    },
    bundle: true,
    platform: "node",
    target: "node20",
    format: "esm",
    splitting: true,
    outdir,
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    outExtension: { ".js": ".mjs" },
    // Bundled CJS deps (e.g. @vercel/oidc via ai/@ai-sdk/gateway) call
    // require("path"). Provide createRequire so those work under ESM.
    banner: {
      js: `import { createRequire as __ariaCreateRequire } from "node:module";
const require = __ariaCreateRequire(import.meta.url);`,
    },
    // The compiler loads astro.wasm relative to its own import.meta.url. It must
    // remain a real package import; bundling relocates that URL to main.mjs.
    // isomorphic-dompurify → jsdom reads default-stylesheet.css via __dirname;
    // bundling into ESM leaves __dirname undefined and breaks app load. TypeScript
    // also relies on its real CommonJS filename to locate lib files and probe the
    // filesystem, so keep its runtime package intact as well.
    external: [
      "electron",
      "node-pty",
      "@astrojs/compiler",
      "@astrojs/compiler/*",
      "isomorphic-dompurify",
      "jsdom",
      "typescript",
      "electron-updater",
    ],
    sourcemap: process.env.ARIA_SOURCEMAP === "1",
    logLevel: "info",
  });

  await esbuild.build({
    entryPoints: [path.join(root, "electron/preload.ts")],
    bundle: true,
    platform: "node",
    target: "node20",
    outfile: path.join(outdir, "preload.cjs"),
    format: "cjs",
    external: ["electron", "node-pty"],
    sourcemap: process.env.ARIA_SOURCEMAP === "1",
    logLevel: "info",
  });
}

// Composer marker kernel: copied into each project's node_modules/.aria/
// so Aria-owned `astro dev` can parse/serialize without mutating user config.
// @astrojs/compiler stays external — writeMarkerConfig vendors it beside the kernel.
await esbuild.build({
  entryPoints: [path.join(root, "electron/composer/kernelEntry.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: path.join(outdir, "composer-kernel.mjs"),
  format: "esm",
  external: ["@astrojs/compiler", "@astrojs/compiler/*"],
  sourcemap: process.env.ARIA_SOURCEMAP === "1",
  logLevel: "info",
});
