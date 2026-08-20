import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeTextFileAtomic } from "./pathSafety";

describe("atomic file replacement", () => {
  const roots: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("leaves the destination intact when replacement rename fails", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-atomic-"));
    roots.push(root);
    const file = path.join(root, "settings.json");
    fs.writeFileSync(file, "before");
    const unlink = vi.spyOn(fs, "unlinkSync");
    vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
      const error = new Error("sharing violation") as NodeJS.ErrnoException;
      error.code = "EPERM";
      throw error;
    });

    expect(() => writeTextFileAtomic(file, "after")).toThrow("sharing violation");
    expect(fs.readFileSync(file, "utf8")).toBe("before");
    expect(unlink).not.toHaveBeenCalledWith(file);
    expect(fs.readdirSync(root)).toEqual(["settings.json"]);
  });

  it("replaces existing bytes and preserves mode on POSIX", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-atomic-"));
    roots.push(root);
    const file = path.join(root, "settings.json");
    fs.writeFileSync(file, "before", { mode: 0o640 });
    const mode = fs.statSync(file).mode & 0o777;

    writeTextFileAtomic(file, "after");

    expect(fs.readFileSync(file, "utf8")).toBe("after");
    if (process.platform !== "win32") {
      expect(fs.statSync(file).mode & 0o777).toBe(mode);
    }
  });
});
