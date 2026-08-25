import { cp, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceFixture = path.join(root, "tests/fixtures/astro-smoke");
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "aria-cms-bindings-smoke-"));
const fixture = path.join(temporaryRoot, "fixture");
let output = "";
try {
  await cp(sourceFixture, fixture, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceFixture, source).replaceAll(path.sep, "/");
      return relative !== "node_modules"
        && relative !== "dist"
        && relative !== ".astro"
        && relative !== "src/aria"
        && relative !== "src/middleware.ts";
    },
  });
  await symlink(path.join(sourceFixture, "node_modules"), path.join(fixture, "node_modules"), "dir");
  execFileSync(
    process.execPath,
    [path.join(fixture, "node_modules/astro/bin/astro.mjs"), "build"],
    { cwd: fixture, stdio: "inherit" },
  );
  output = await readFile(
    path.join(fixture, "dist/cms-bindings/index.html"),
    "utf8",
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

const expected = [
  ['data-smoke="single"', "single-entry binding"],
  ['data-smoke="loop"', "collection loop"],
  ['data-smoke="reference">Ada Lovelace', "one-hop author reference"],
  ['data-smoke="relation">Visual editing', "first relation item"],
  ["Your Astro project, now visual.", "first loop sample"],
  ["Model content. Bind it visually.", "second loop sample"],
];

for (const [value, label] of expected) {
  if (!output.includes(value)) {
    throw new Error(`CMS binding smoke did not render ${label}.`);
  }
}

console.log("smoke-cms-bindings: ok");
