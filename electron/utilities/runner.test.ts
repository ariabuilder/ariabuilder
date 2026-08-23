import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAstroSync } from "./runner";

const roots: string[] = [];

function createProject(script: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria utility runner "));
  roots.push(root);
  const packageRoot = path.join(root, "node_modules", "astro");
  fs.mkdirSync(path.join(packageRoot, "bin"), { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ bin: { astro: "bin/cli.mjs" } }),
  );
  fs.writeFileSync(path.join(packageRoot, "bin", "cli.mjs"), script);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("Astro utility runner", () => {
  it("runs the project JavaScript entry directly from a path containing spaces", async () => {
    const root = createProject(`
      if (process.argv[2] !== "sync") process.exitCode = 9;
      process.stdout.write("\\u001b[31mstdout\\u001b[0m\\n");
      process.stderr.write("stderr\\n");
    `);
    const logs: string[] = [];

    await runAstroSync(root, (chunk) => logs.push(chunk));

    expect(logs[0]).toBe("> astro sync\n\n");
    expect(logs.join("")).toContain("stdout\n");
    expect(logs.join("")).toContain("stderr\n");
    expect(logs.join("")).not.toContain("\u001b");
  });

  it("reports a missing project-local Astro package", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria utility missing "));
    roots.push(root);
    await expect(runAstroSync(root, () => undefined)).rejects.toThrow(
      "The project-local Astro CLI is unavailable after installation.",
    );
  });

  it("reports a nonzero Astro exit", async () => {
    const root = createProject("process.exitCode = 7;");
    await expect(runAstroSync(root, () => undefined)).rejects.toThrow(
      "Astro sync failed with code 7.",
    );
  });
});
