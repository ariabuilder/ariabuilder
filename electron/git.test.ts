import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getGitStatus, parsePorcelainStatus } from "./git";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Git porcelain status", () => {
  it("parses NUL-delimited rename destinations without quoted-path decoding", () => {
    const parsed = parsePorcelainStatus([
      "## main...origin/main [ahead 2, behind 1]",
      "R  renamed → café.ts",
      "old name.ts",
      "?? quote\" and space.txt",
      "",
    ].join("\0"));

    expect(parsed).toMatchObject({ branch: "main", upstream: "origin/main", ahead: 2, behind: 1 });
    expect(parsed.staged).toContainEqual({ path: "renamed → café.ts", code: "R " });
    expect(parsed.untracked).toContainEqual({ path: "quote\" and space.txt", code: "??" });
  });

  it("returns raw spaces, quotes, and Unicode paths from a real repository", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-git-paths-"));
    roots.push(root);
    execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "aria@test"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Aria Test"], { cwd: root });

    const original = "old name.txt";
    const renamed = "renamed → café.txt";
    fs.writeFileSync(path.join(root, original), "tracked\n");
    execFileSync("git", ["add", original], { cwd: root });
    execFileSync("git", ["commit", "-m", "initial"], { cwd: root, stdio: "ignore" });
    fs.renameSync(path.join(root, original), path.join(root, renamed));
    execFileSync("git", ["add", "-A"], { cwd: root });

    const unusual = ["space name.txt", "quote\"name.txt", "文件.txt"];
    for (const name of unusual) fs.writeFileSync(path.join(root, name), name);

    const status = await getGitStatus(root);
    expect(status.staged.map((entry) => entry.path)).toContain(renamed);
    expect(status.untracked.map((entry) => entry.path)).toEqual(expect.arrayContaining(unusual));
  });
});
