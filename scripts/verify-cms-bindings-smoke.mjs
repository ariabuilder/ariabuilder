import { readFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = path.join(root, "tests/fixtures/astro-smoke");
execFileSync(
  process.execPath,
  [path.join(fixture, "node_modules/astro/bin/astro.mjs"), "build"],
  { cwd: fixture, stdio: "inherit" },
);
const output = await readFile(
  path.join(fixture, "dist/cms-bindings/index.html"),
  "utf8",
);

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
