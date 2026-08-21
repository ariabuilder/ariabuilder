import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import * as esbuild from "esbuild";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(tmpdir(), `aria-git-smoke-${Date.now()}.cjs`);

await esbuild.build({
  entryPoints: [path.join(root, "electron/git.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: out,
  packages: "external",
});

const require = createRequire(import.meta.url);
const { parsePorcelainStatus, getGitStatus, commitAll } = require(out);

const sample = [
  "## main...origin/main [ahead 2, behind 1]",
  "M  staged.ts",
  " M unstaged.ts",
  "MM both.ts",
  "?? untracked.ts",
  "R  renamed → café.ts",
  "old name.ts",
  "",
].join("\0");

const parsed = parsePorcelainStatus(sample);
assert.equal(parsed.branch, "main");
assert.equal(parsed.upstream, "origin/main");
assert.equal(parsed.ahead, 2);
assert.equal(parsed.behind, 1);
assert.equal(parsed.staged.length, 3);
assert.equal(parsed.unstaged.length, 2);
assert.equal(parsed.untracked.length, 1);
assert.equal(parsed.dirty, true);
assert.ok(parsed.staged.some((f) => f.path === "renamed → café.ts"));

const fixture = mkdtempSync(path.join(tmpdir(), "aria-git-repo-"));
try {
  execFileSync("git", ["init"], { cwd: fixture, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "aria@test"], {
    cwd: fixture,
    stdio: "ignore",
  });
  execFileSync("git", ["config", "user.name", "Aria Smoke"], {
    cwd: fixture,
    stdio: "ignore",
  });
  writeFileSync(path.join(fixture, "README.md"), "# aria\n");
  const dirty = await getGitStatus(fixture);
  assert.equal(dirty.isRepo, true);
  assert.equal(dirty.dirty, true);
  assert.ok(dirty.untracked.some((f) => f.path === "README.md"));

  const committed = await commitAll(fixture, "Initial commit");
  assert.equal(committed.dirty, false);
  assert.ok(committed.branch);

  const clean = await getGitStatus(fixture);
  assert.equal(clean.dirty, false);
  console.log("smoke-git: ok");
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(out, { force: true });
}
