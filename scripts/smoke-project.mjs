/**
 * Smoke-test pure project helpers (no Electron dialogs).
 */
import { createRequire } from "node:module";
import {
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  writeFileSync,
  rmSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const mockApi = path.join(root, "scripts/mocks/electron-api.mjs");
const out = path.join(tmpdir(), `aria-project-smoke-${Date.now()}.cjs`);
const workspaceOut = path.join(tmpdir(), `aria-workspace-smoke-${Date.now()}.cjs`);

await esbuild.build({
  entryPoints: [path.join(root, "electron/project.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: out,
  plugins: [
    {
      name: "mock-electron-api",
      setup(build) {
        build.onResolve({ filter: /electron-api$/ }, () => ({
          path: mockApi,
        }));
      },
    },
  ],
});
await esbuild.build({
  entryPoints: [path.join(root, "electron/workspace.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: workspaceOut,
});

const require = createRequire(import.meta.url);
const project = require(out);
const workspace = require(workspaceOut);

const astroDir = mkdtempSync(path.join(tmpdir(), "aria-astro-"));
writeFileSync(
  path.join(astroDir, "package.json"),
  JSON.stringify({ dependencies: { astro: "^5.0.0" } }),
);

const emptyDir = mkdtempSync(path.join(tmpdir(), "aria-empty-"));
const userData = mkdtempSync(path.join(tmpdir(), "aria-userdata-"));
const outside = mkdtempSync(path.join(tmpdir(), "aria-outside-"));
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  rmSync(astroDir, { recursive: true, force: true });
  rmSync(emptyDir, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  rmSync(userData, { recursive: true, force: true });
  rmSync(out, { force: true });
  rmSync(workspaceOut, { force: true });
}
process.once("exit", cleanup);

if (!project.isAstroProject(astroDir)) throw new Error("expected astro project");
if (project.isAstroProject(emptyDir)) throw new Error("empty should not be astro");

mkdirSync(path.join(astroDir, "src", "pages"), { recursive: true });
mkdirSync(path.join(astroDir, "src", "layouts"), { recursive: true });
mkdirSync(path.join(astroDir, "src", "components"), { recursive: true });
writeFileSync(path.join(astroDir, "src", "pages", "About.MDX"), "# About\n");
writeFileSync(path.join(astroDir, "src", "layouts", "Base.astro"), "---\n---\n<div />\n");
writeFileSync(path.join(astroDir, "src", "components", "Button.astro"), "---\n---\n<button />\n");
writeFileSync(path.join(astroDir, "src", "pages", "data.json"), "{}\n");
const scan = await workspace.scanProject(astroDir);
if (!scan.pages.some((page) => page.route === "/About")) {
  throw new Error(`uppercase page extension was not scanned: ${JSON.stringify(scan.pages)}`);
}
if (scan.counts.layouts !== 1 || scan.counts.components !== 1) {
  throw new Error(`unexpected scan counts: ${JSON.stringify(scan.counts)}`);
}
let rejectedUnsupportedPage = false;
try {
  workspace.resolvePageFilePath(astroDir, "src/pages/data.json");
} catch {
  rejectedUnsupportedPage = true;
}
if (!rejectedUnsupportedPage) throw new Error("unsupported page file was accepted");
const created = workspace.createPage(astroDir, "nested/contact");
if (created.route !== "/nested/contact") throw new Error("page creation route mismatch");
const resolved = workspace.resolvePageFilePath(astroDir, created.file);
if (!existsSync(resolved)) throw new Error("created page was not written");
workspace.deletePage(astroDir, created.file);
if (existsSync(resolved)) throw new Error("created page was not deleted");

if (process.platform !== "win32") {
  symlinkSync(outside, path.join(astroDir, "src", "pages", "linked"), "dir");
  let escaped = false;
  try {
    workspace.createPage(astroDir, "linked/escape");
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error("symlinked page path escaped the project");

  const pagesAlias = path.join(userData, "pages-alias");
  mkdirSync(pagesAlias, { recursive: true });
  rmSync(path.join(astroDir, "src", "pages"), { recursive: true, force: true });
  symlinkSync(pagesAlias, path.join(astroDir, "src", "pages"), "dir");
  let rejectedPagesAlias = false;
  try {
    await workspace.scanProject(astroDir);
  } catch {
    rejectedPagesAlias = true;
  }
  if (!rejectedPagesAlias) throw new Error("src/pages symlink alias was accepted");
}

project.addRecent(userData, astroDir);
let recents = project.listRecents(userData);
if (recents.length !== 1 || recents[0].path !== realpathSync.native(astroDir)) {
  throw new Error(`unexpected recents: ${JSON.stringify(recents)}`);
}
project.removeRecent(userData, astroDir);
recents = project.listRecents(userData);
if (recents.length !== 0) throw new Error("expected empty recents");

if (!existsSync(path.join(userData, "recents.json"))) {
  throw new Error("missing recents file");
}

cleanup();

console.log("smoke-project: ok");
