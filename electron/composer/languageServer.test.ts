import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  completeComposerCode,
  stopAllComposerLanguageServers,
} from "./languageServer";

describe("Astro Composer language server", () => {
  let root = "";

  afterEach(async () => {
    await stopAllComposerLanguageServers();
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("returns official Astro/HTML completions for an in-memory draft", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-astro-ls-"));
    fs.mkdirSync(path.join(root, "src/pages"), { recursive: true });
    fs.writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");
    fs.writeFileSync(path.join(root, "src/pages/index.astro"), "<div />\n", "utf8");

    const result = await completeComposerCode({
      projectPath: root,
      relativeFile: "src/pages/index.astro",
      source: "<d",
      position: { line: 0, character: 2 },
    });
    expect(result.completions.some((item) => item.label === "div")).toBe(true);
  }, 20_000);
});
