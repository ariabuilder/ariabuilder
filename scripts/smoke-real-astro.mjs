import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as esbuild from "esbuild";

/**
 * Optional real-Astro runtime smoke (not part of `npm test` / `test:fast`).
 * Requires ARIA_SMOKE_ASTRO_PROJECT pointing at an installed Astro project.
 */
const project = process.env.ARIA_SMOKE_ASTRO_PROJECT;
if (!project) {
  throw new Error("Set ARIA_SMOKE_ASTRO_PROJECT to an installed Astro project.");
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = mkdtempSync(path.join(tmpdir(), ".aria-real-runtime-"));
const out = path.join(outDir, "runtime.mjs");
// Match the packaged main bundle's module-resolution anchor while keeping the
// generated smoke bundle outside the checkout.
const runtimeBundleUrl = pathToFileURL(path.join(root, "dist-electron", "main.mjs")).href;
const typescriptEntry = fileURLToPath(import.meta.resolve("typescript"));
const externalizeTypeScript = {
  name: "externalize-typescript",
  setup(build) {
    build.onResolve({ filter: /^typescript$/ }, () => ({
      path: pathToFileURL(typescriptEntry).href,
      external: true,
    }));
  },
};
let manager;
try {
  await esbuild.build({
    entryPoints: [path.join(root, "electron/astroRuntime.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: out,
    define: { "import.meta.url": JSON.stringify(runtimeBundleUrl) },
    banner: {
      js: `import { createRequire as __ariaCreateRequire } from "node:module";
const require = __ariaCreateRequire(${JSON.stringify(runtimeBundleUrl)});`,
    },
    plugins: [externalizeTypeScript],
  });
  const {
    AstroRuntimeManager,
    prepareComponentAuthoringPreview,
  } = await import(pathToFileURL(out).href);
  manager = new AstroRuntimeManager(() => undefined);
  const live = await manager.start(project);
  if (live.status !== "live" || !live.previewUrl) {
    const logs = live.logs?.length ? `\n${live.logs.join("\n")}` : "";
    throw new Error(
      `${live.error ?? "The real Astro project did not become ready."}${logs}`,
    );
  }
  const response = await fetch(`${live.previewUrl}/`);
  if (response.status >= 400) {
    throw new Error(`Astro returned HTTP ${response.status} for ${live.previewUrl}/`);
  }
  const composerRoute = process.env.ARIA_SMOKE_COMPOSER_ROUTE;
  if (composerRoute) {
    const publicUrl = new URL(composerRoute, live.previewUrl);
    const publicResponse = await fetch(publicUrl);
    if (publicResponse.status >= 400) {
      throw new Error(
        `Astro returned HTTP ${publicResponse.status} for public route ${publicUrl}`,
      );
    }
    const publicHtml = await publicResponse.text();
    const expectedHtml = process.env.ARIA_SMOKE_EXPECT_HTML;
    if (expectedHtml && !publicHtml.includes(expectedHtml)) {
      throw new Error(
        `Public route ${publicUrl.pathname} did not contain the expected authored output`,
      );
    }

    const selectedUrl = new URL(composerRoute, live.previewUrl);
    selectedUrl.searchParams.set("aria-design", "1");
    const composerResponse = await fetch(selectedUrl);
    const renderedUrl = new URL(composerResponse.url);
    if (composerResponse.status >= 400) {
      throw new Error(
        `Astro returned HTTP ${composerResponse.status} for Composer route ${selectedUrl}`,
      );
    }
    if (renderedUrl.pathname !== selectedUrl.pathname) {
      throw new Error(
        `Composer route ${selectedUrl.pathname} redirected to ${renderedUrl.pathname}`,
      );
    }
    const composerHtml = await composerResponse.text();
    if (!composerHtml.includes("data-aria-s")) {
      throw new Error(
        `Composer route ${selectedUrl.pathname} rendered without editable source markers`,
      );
    }
  }
  const requestedComponent =
    process.env.ARIA_SMOKE_COMPONENT || "src/components/sections/Hero.astro";
  if (existsSync(path.join(project, ...requestedComponent.split("/")))) {
    const preview = prepareComponentAuthoringPreview(project, requestedComponent);
    let componentResponse = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      componentResponse = await fetch(`${live.previewUrl}${preview.route}?smoke=${Date.now()}`);
      if (componentResponse.status < 500) break;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    if (!componentResponse || componentResponse.status >= 400) {
      throw new Error(
        `Astro returned HTTP ${componentResponse?.status ?? "unknown"} for the isolated component authoring route`,
      );
    }
    const html = await componentResponse.text();
    if (!html.includes("data-aria-component-authoring")) {
      throw new Error("Isolated component authoring route did not render its target marker");
    }
  }
  console.log(`smoke-real-astro: ok (${live.previewUrl})`);
} finally {
  if (manager) await manager.stop(project).catch(() => undefined);
  rmSync(outDir, { recursive: true, force: true });
}
