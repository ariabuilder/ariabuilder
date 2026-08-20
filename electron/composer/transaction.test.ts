import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAstro } from "../../shared/composer/parseAstro";
import { setTextAtPath } from "../../shared/composer/mutate";
import { createAriaPrimitiveNode } from "../../shared/composer/ariaPrimitives";
import { commitComposerEditTransaction } from "./transaction";
import {
  composerJournalFileForProject,
  configureComposerDraftPreview,
  type ComposerWriteJournal,
} from "./draftPreview";

describe("ComposerEditTransaction", () => {
  let root = "";
  let page = "";
  let stylesheet = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-composer-tx-"));
    page = path.join(root, "src/pages/index.astro");
    stylesheet = path.join(root, "src/styles/global.css");
    fs.mkdirSync(path.dirname(page), { recursive: true });
    fs.mkdirSync(path.dirname(stylesheet), { recursive: true });
    fs.writeFileSync(page, "---\n---\n<p>Hello</p>\n", "utf8");
    fs.writeFileSync(stylesheet, ".card { color: red; }\n", "utf8");
    configureComposerDraftPreview(path.join(root, ".composer-user-data"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("commits an Astro edit and stylesheet edit after one preflight", async () => {
    const parsed = await parseAstro(fs.readFileSync(page, "utf8"));
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    const mutation = setTextAtPath(parsed.model, "0.0", "Updated");
    expect(mutation.ok).toBe(true);

    const result = commitComposerEditTransaction({
      projectPath: root,
      page: {
        relativeFile: "src/pages/index.astro",
        model: parsed.model,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      },
      stylesheets: [
        {
          relativeFile: "src/styles/global.css",
          content: ".card { color: blue; }\n",
          expectedMtimeMs: Math.floor(fs.statSync(stylesheet).mtimeMs),
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(page, "utf8")).toContain("Updated");
    expect(fs.readFileSync(stylesheet, "utf8")).toContain("blue");
    if (result.ok) {
      expect(result.revisions).toHaveLength(2);
      expect(result.transactionId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.changedFiles.map((file) => file.relativeFile)).toEqual([
        "src/pages/index.astro",
        "src/styles/global.css",
        "src/aria/motion.generated.ts",
      ]);
      expect(result.changedFiles.every((file) => /^[0-9a-f]{64}$/.test(file.contentHash))).toBe(true);
      expect(result.runtimeAssetsChanged).toBe(false);
    }
  });

  it("blocks the whole transaction when any revision is stale", async () => {
    const pageBefore = fs.readFileSync(page, "utf8");
    const cssBefore = fs.readFileSync(stylesheet, "utf8");
    const parsed = await parseAstro(pageBefore);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;

    const result = commitComposerEditTransaction({
      projectPath: root,
      page: {
        relativeFile: "src/pages/index.astro",
        model: parsed.model,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      },
      stylesheets: [
        {
          relativeFile: "src/styles/global.css",
          content: ".card { color: blue; }\n",
          expectedMtimeMs: Math.floor(fs.statSync(stylesheet).mtimeMs) - 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(page, "utf8")).toBe(pageBefore);
    expect(fs.readFileSync(stylesheet, "utf8")).toBe(cssBefore);
    if (!result.ok) {
      expect(result.code).toBe("mtime_conflict");
      expect(result.conflicts[0]?.relativeFile).toBe("src/styles/global.css");
    }
  });

  it("commits multiple Astro documents through one revision preflight", async () => {
    const layout = path.join(root, "src/layouts/Base.astro");
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(layout, "---\n---\n<slot name=\"aside\" />\n", "utf8");
    const parsedPage = await parseAstro(fs.readFileSync(page, "utf8"));
    const parsedLayout = await parseAstro(fs.readFileSync(layout, "utf8"));
    expect(parsedPage.editable && parsedLayout.editable).toBe(true);
    if (!parsedPage.editable || !parsedLayout.editable) return;
    setTextAtPath(parsedPage.model, "0.0", "Page updated");
    parsedLayout.model.nodes[0]!.kind === "slot" &&
      (parsedLayout.model.nodes[0]!.props.name = {
        type: "string",
        value: "sidebar",
      });

    const result = commitComposerEditTransaction({
      projectPath: root,
      pages: [
        {
          relativeFile: "src/pages/index.astro",
          model: parsedPage.model,
          expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
        },
        {
          relativeFile: "src/layouts/Base.astro",
          model: parsedLayout.model,
          expectedMtimeMs: Math.floor(fs.statSync(layout).mtimeMs),
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(page, "utf8")).toContain("Page updated");
    expect(fs.readFileSync(layout, "utf8")).toContain('name="sidebar"');
    if (result.ok) expect(result.revisions).toHaveLength(2);
  });

  it("does not write any Astro document when one page revision is stale", async () => {
    const layout = path.join(root, "src/layouts/Base.astro");
    fs.mkdirSync(path.dirname(layout), { recursive: true });
    fs.writeFileSync(layout, "---\n---\n<slot />\n", "utf8");
    const pageBefore = fs.readFileSync(page, "utf8");
    const layoutBefore = fs.readFileSync(layout, "utf8");
    const parsedPage = await parseAstro(pageBefore);
    const parsedLayout = await parseAstro(layoutBefore);
    if (!parsedPage.editable || !parsedLayout.editable) return;
    setTextAtPath(parsedPage.model, "0.0", "Blocked");

    const result = commitComposerEditTransaction({
      projectPath: root,
      pages: [
        {
          relativeFile: "src/pages/index.astro",
          model: parsedPage.model,
          expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
        },
        {
          relativeFile: "src/layouts/Base.astro",
          model: parsedLayout.model,
          expectedMtimeMs: Math.floor(fs.statSync(layout).mtimeMs) - 1,
        },
      ],
    });

    expect(result.ok).toBe(false);
    expect(fs.readFileSync(page, "utf8")).toBe(pageBefore);
    expect(fs.readFileSync(layout, "utf8")).toBe(layoutBefore);
  });

  it("commits compiler-valid Code mode source without reformatting it", () => {
    const source = `---\nconst label='Code mode'\n---\n<main>  {label}  </main>\n`;
    const result = commitComposerEditTransaction({
      projectPath: root,
      sources: [{
        relativeFile: "src/pages/index.astro",
        source,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      }],
    });

    expect(result.ok).toBe(true);
    expect(fs.readFileSync(page, "utf8")).toBe(source);
  });

  it("detects a Code mode source conflict even without an mtime precondition", () => {
    const expectedSource = fs.readFileSync(page, "utf8");
    fs.writeFileSync(page, "<main>External edit</main>\n", "utf8");
    const result = commitComposerEditTransaction({
      projectPath: root,
      sources: [{
        relativeFile: "src/pages/index.astro",
        source: "<main>Draft edit</main>\n",
        expectedSource,
      }],
    });
    expect(result.ok).toBe(false);
    expect(fs.readFileSync(page, "utf8")).toBe("<main>External edit</main>\n");
  });

  it("rejects invalid or marked Code mode source before writing", () => {
    const before = fs.readFileSync(page, "utf8");
    expect(() => commitComposerEditTransaction({
      projectPath: root,
      sources: [{
        relativeFile: "src/pages/index.astro",
        source: '<main title="unterminated></main>',
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      }],
    })).toThrow(/Astro compiler rejected/);
    expect(fs.readFileSync(page, "utf8")).toBe(before);

    expect(() => commitComposerEditTransaction({
      projectPath: root,
      sources: [{
        relativeFile: "src/pages/index.astro",
        source: '<main data-aria-s="0"></main>',
      }],
    })).toThrow(/marked Composer source/);
    expect(fs.readFileSync(page, "utf8")).toBe(before);
  });

  it("creates and deletes only allowlisted managed motion artifacts", () => {
    const generated = path.join(root, "src/aria/motion.generated.ts");
    const created = commitComposerEditTransaction({
      projectPath: root,
      managedArtifacts: [{
        owner: "motion",
        relativeFile: "src/aria/motion.generated.ts",
        content: "export const ariaMotionSlots = {};\n",
      }],
    });
    expect(created.ok).toBe(true);
    expect(fs.readFileSync(generated, "utf8")).toContain("ariaMotionSlots");
    const removed = commitComposerEditTransaction({
      projectPath: root,
      previewRevision: 2,
      managedArtifacts: [{
        owner: "motion",
        relativeFile: "src/aria/motion.generated.ts",
        content: null,
        expectedMtimeMs: Math.floor(fs.statSync(generated).mtimeMs),
      }],
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) throw new Error("expected successful managed transaction");
    expect(removed.previewRevision).toBe(2);
    expect(removed.changedFiles).toContainEqual(expect.objectContaining({
      relativeFile: "src/aria/motion.generated.ts",
      role: "runtime",
    }));
    expect(fs.existsSync(generated)).toBe(false);
    const journal = JSON.parse(
      fs.readFileSync(composerJournalFileForProject(root), "utf8"),
    ) as ComposerWriteJournal;
    expect(journal.files).toContainEqual(expect.objectContaining({
      relativeFile: "src/aria/motion.generated.ts",
      deleted: true,
      role: "runtime",
    }));
    expect(journal.complete).toBe(true);
  });

  it("rejects non-allowlisted managed artifacts", () => {
    expect(() => commitComposerEditTransaction({
      projectPath: root,
      managedArtifacts: [{
        owner: "motion",
        relativeFile: "src/pages/owned-by-user.astro",
        content: "nope",
      }],
    })).toThrow(/not allowlisted/);
  });

  it("seeds Design BEM primitive CSS when a Card is written", async () => {
    const parsed = await parseAstro(`---\n---\n<body></body>\n`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    parsed.model.nodes = [createAriaPrimitiveNode("card")];

    const result = commitComposerEditTransaction({
      projectPath: root,
      page: {
        relativeFile: "src/pages/index.astro",
        model: parsed.model,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      },
    });

    expect(result.ok).toBe(true);
    const css = fs.readFileSync(stylesheet, "utf8");
    expect(css).toContain("/* aria:primitives */");
    expect(css).toContain(".aria-card {");
    expect(fs.readFileSync(page, "utf8")).toContain('class="aria-card"');
    expect(css).not.toMatch(/style=/);
  });

  it("refreshes stale Design BEM primitive CSS when an Alert is written", async () => {
    const parsed = await parseAstro(`---\n---\n<body></body>\n`);
    expect(parsed.editable).toBe(true);
    if (!parsed.editable) return;
    parsed.model.nodes = [createAriaPrimitiveNode("card")];
    const seeded = commitComposerEditTransaction({
      projectPath: root,
      page: {
        relativeFile: "src/pages/index.astro",
        model: parsed.model,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      },
    });
    expect(seeded.ok).toBe(true);

    const stale = fs.readFileSync(stylesheet, "utf8").replace(
      /\/\* aria:primitives \*\/[\s\S]*?(?=\/\* aria:(?:classes|design-end))/,
      `/* aria:primitives */\n.aria-alert {\n  border-left-width: 3px;\n}\n.aria-alert--info {\n  border-left-color: dodgerblue;\n}\n\n`,
    );
    fs.writeFileSync(stylesheet, stale, "utf8");

    const nextParsed = await parseAstro(fs.readFileSync(page, "utf8"));
    expect(nextParsed.editable).toBe(true);
    if (!nextParsed.editable) return;
    nextParsed.model.nodes = [createAriaPrimitiveNode("alert")];
    const result = commitComposerEditTransaction({
      projectPath: root,
      page: {
        relativeFile: "src/pages/index.astro",
        model: nextParsed.model,
        expectedMtimeMs: Math.floor(fs.statSync(page).mtimeMs),
      },
    });
    expect(result.ok).toBe(true);

    const css = fs.readFileSync(stylesheet, "utf8");
    expect(css).toContain("border: none;");
    expect(css).toContain("border-left: none;");
    expect(css).not.toContain("border-left-width: 3px");
    expect(css).not.toContain("border-left-color: dodgerblue");
    expect(css).toContain(".aria-alert__icon");
    expect(css).toContain("max-width: 1.15rem;");
    expect(css).toContain(".aria-alert--info .aria-alert__title");
    expect(fs.readFileSync(page, "utf8")).toContain('width="18"');
  });
});
