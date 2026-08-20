import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveLocalAstroCommand } from "./astroCli";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe("local Astro CLI resolution", () => {
  it("uses the package entry rather than platform shell shims", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-astro-cli-"));
    roots.push(root);
    const packageRoot = path.join(root, "node_modules", "astro");
    fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({ bin: { astro: "bin/cli.js" } }));
    fs.writeFileSync(path.join(packageRoot, "bin", "cli.js"), "");
    fs.mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", ".bin", "astro.cmd"), "unsafe shim");

    const command = resolveLocalAstroCommand(root, ["sync"]);
    expect(command?.entry).toBe(path.join(packageRoot, "bin", "cli.js"));
    expect(command?.args).toEqual([command?.entry, "sync"]);
  });
});
