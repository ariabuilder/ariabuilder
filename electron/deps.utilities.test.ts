import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolvePackageMutationCommand } from "./deps";

const roots: string[] = [];

function rootWith(lockfile?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-deps-utility-"));
  roots.push(root);
  if (lockfile) fs.writeFileSync(path.join(root, lockfile), "");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
describe("utility package commands", () => {
  it("adds npm packages as development dependencies", () => {
    const command = resolvePackageMutationCommand(
      rootWith("package-lock.json"),
      "add",
      ["tailwindcss@^4", "@tailwindcss/vite@^4"],
    );
    expect(command.manager).toBe("npm");
    expect(command.args).toEqual([
      "install",
      "--save-dev",
      "tailwindcss@^4",
      "@tailwindcss/vite@^4",
    ]);
  });

  it("uses the detected package manager for removal", () => {
    const command = resolvePackageMutationCommand(
      rootWith("pnpm-lock.yaml"),
      "remove",
      ["tailwindcss", "@tailwindcss/vite"],
    );
    expect(command.manager).toBe("pnpm");
    expect(command.args).toEqual(["remove", "tailwindcss", "@tailwindcss/vite"]);
  });
});
