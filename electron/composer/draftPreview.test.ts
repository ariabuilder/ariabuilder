import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearComposerPreviewDraft,
  composerDraftFileForProject,
  configureComposerDraftPreview,
  setComposerPreviewDraft,
} from "./draftPreview";

describe("Composer preview draft lease", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-code-preview-project-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-code-preview-userdata-"));
    fs.mkdirSync(path.join(root, "src/pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), "<main />", "utf8");
    configureComposerDraftPreview(userData);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("stores one app-local draft per project and enforces its lease", () => {
    const first = setComposerPreviewDraft({
      projectPath: root,
      relativeFile: "src/pages/index.astro",
      source: "<main>Draft</main>",
      leaseId: "window-a",
    });
    expect(first.revision).toBe(1);
    const stored = composerDraftFileForProject(root);
    expect(stored.startsWith(userData)).toBe(true);
    expect(fs.readFileSync(stored, "utf8")).toContain("Draft");

    expect(() => setComposerPreviewDraft({
      projectPath: root,
      relativeFile: "src/pages/index.astro",
      source: "<main>Other</main>",
      leaseId: "window-b",
    })).toThrow(/owns this project's preview draft/);
    expect(clearComposerPreviewDraft({ projectPath: root, leaseId: "window-b" }).cleared).toBe(false);
    expect(clearComposerPreviewDraft({ projectPath: root, leaseId: "window-a" }).cleared).toBe(true);
  });

  it("removes crash-left preview drafts when a new app session starts", () => {
    setComposerPreviewDraft({
      projectPath: root,
      relativeFile: "src/pages/index.astro",
      source: "<main>Stale draft</main>",
      leaseId: "crashed-window",
    });
    const stored = composerDraftFileForProject(root);
    expect(fs.existsSync(stored)).toBe(true);

    configureComposerDraftPreview(userData);

    expect(fs.existsSync(stored)).toBe(false);
  });
});
