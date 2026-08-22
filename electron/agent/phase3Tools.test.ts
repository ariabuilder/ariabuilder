import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureMutationCoordinator } from "../mutations";
import { invokeAgentTool, listAgentToolDescriptors } from "./toolRegistry";
import {
  createClassPatch,
  disableFontPatch,
  enableFontsourceFontPatch,
  enableGoogleFontPatch,
  manageCssVariablesPatch,
} from "./designManagerOps";
import {
  EMPTY_DESIGN_FONTS,
  EMPTY_DESIGN_META,
  createEmptyGlobalStyles,
  type DesignSnapshot,
} from "../../shared/design";

function blankSnapshot(overrides: Partial<DesignSnapshot> = {}): DesignSnapshot {
  return {
    revision: "d-test",
    entryRelativePath: "src/styles/global.css",
    stylesheets: [],
    sourceFiles: [],
    sources: [],
    tokens: [],
    diagnostics: [],
    variables: { custom: {}, aliases: {} },
    colors: { palettes: [], semantic: {}, siteTokenRefs: [] },
    globalStyles: createEmptyGlobalStyles(),
    classes: [],
    fonts: { ...EMPTY_DESIGN_FONTS },
    icons: { enabledPacks: [] },
    meta: structuredClone(EMPTY_DESIGN_META),
    ...overrides,
  };
}

describe("phase 3 design manager ops", () => {
  it("creates, updates, and enables fonts via patches", () => {
    const base = blankSnapshot();
    const created = createClassPatch(base, "hero-title", "font-size: 2rem;");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.patch.classes?.[0]).toMatchObject({
      name: "hero-title",
      css: ".hero-title {\n  font-size: 2rem;\n}",
    });

    const withClass = blankSnapshot({
      classes: [{ name: "hero-title", css: "font-size: 2rem;", source: "aria" }],
    });
    const font = enableGoogleFontPatch(withClass, "Inter", [400, 600]);
    expect(font.ok).toBe(true);
    if (!font.ok) return;
    expect(font.patch.fonts?.google).toEqual([{ family: "Inter", weights: [400, 600] }]);
    expect(font.patch.fonts?.fontsource).toEqual([]);

    const fontsource = enableFontsourceFontPatch(withClass, {
      id: "outfit",
      family: "Outfit",
      variable: true,
    });
    expect(fontsource.ok).toBe(true);
    if (!fontsource.ok) return;
    expect(fontsource.patch.fonts?.fontsource).toEqual([
      { id: "outfit", family: "Outfit", variable: true },
    ]);
    expect(fontsource.patch.fonts?.google).toEqual([]);

    const withBoth = blankSnapshot({
      fonts: {
        ...EMPTY_DESIGN_FONTS,
        google: [{ family: "Inter", weights: [400] }],
        fontsource: [{ id: "outfit", family: "Outfit", variable: true }],
      },
    });
    const disabled = disableFontPatch(withBoth, "Outfit Variable");
    expect(disabled.ok).toBe(true);
    if (!disabled.ok) return;
    expect(disabled.patch.fonts?.fontsource).toEqual([]);
    expect(disabled.patch.fonts?.google).toEqual([{ family: "Inter", weights: [400] }]);

    const vars = manageCssVariablesPatch(withClass, {
      operation: "set_custom",
      key: "brand-gap",
      definition: { value: "1.5rem", category: "spacing" },
    });
    expect(vars.ok).toBe(true);
    if (!vars.ok) return;
    expect(vars.patch.variables?.custom["brand-gap"]?.value).toBe("1.5rem");
  });
});

describe("phase 3 wired desktop agent tools", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase3-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase3-user-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "layouts"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "styles"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "pages", "index.astro"),
      "---\n---\n<section><h1>Home</h1></section>\n",
    );
    fs.writeFileSync(
      path.join(root, "src", "layouts", "BaseLayout.astro"),
      "---\n---\n<html><body><slot /><slot name=\"aside\" /></body></html>\n",
    );
    fs.writeFileSync(path.join(root, "src", "styles", "global.css"), "/* site */\n");
    configureMutationCoordinator(userData);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const runtime = () => ({
    projectPath: root,
    userData,
    webContentsId: 1,
  });

  it("lists classes/fonts and creates a class behind revision fencing", async () => {
    const listed = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_list_classes",
      args: {},
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const revision = (listed.data as { revision: string }).revision;

    const fonts = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_list_fonts",
      args: {},
    });
    expect(fonts.ok).toBe(true);

    const conflict = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_create_class",
      args: { name: "card", css: "padding: 1rem;", expectedRevision: "stale" },
    });
    expect(conflict.ok).toBe(false);
    expect(JSON.stringify(conflict)).toContain("CONFLICT");

    const created = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_create_class",
      args: { name: "card", css: "padding: 1rem;", expectedRevision: revision },
    });
    expect(created.ok).toBe(true);
  });

  it("duplicates a document and saves closed source with mtime fencing", async () => {
    const sourceFile = "src/pages/index.astro";
    const absolute = path.join(root, sourceFile);
    const expectedMtimeMs = Math.floor(fs.statSync(absolute).mtimeMs);
    const source = fs.readFileSync(absolute, "utf8");

    const duplicated = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_duplicate_document",
      args: { kind: "page", sourceFile, name: "about" },
    });
    expect(duplicated.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "pages", "about.astro"))).toBe(true);
    expect(fs.readFileSync(path.join(root, "src", "pages", "about.astro"), "utf8")).toBe(
      source,
    );

    const saved = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_save_document",
      args: {
        file: sourceFile,
        source: "---\n---\n<section><h1>Updated</h1></section>\n",
        expectedMtimeMs,
      },
      approvedBySdk: true,
    });
    expect(saved.ok).toBe(true);
    expect(fs.readFileSync(absolute, "utf8")).toContain("Updated");
  });

  it("blocks direct and delegated disk writes to the document open in Composer", async () => {
    const sourceFile = "src/pages/index.astro";
    const absolute = path.join(root, sourceFile);
    const source = fs.readFileSync(absolute, "utf8");
    const args = {
      file: sourceFile,
      source: "---\n---\n<section><h1>Unsafe fallback</h1></section>\n",
      expectedMtimeMs: Math.floor(fs.statSync(absolute).mtimeMs),
    };
    const openDocumentRuntime = {
      ...runtime(),
      shellContext: {
        documentContext: { file: sourceFile },
      } as never,
    };

    const direct = await invokeAgentTool({
      runtime: openDocumentRuntime,
      composerMode: "agent",
      toolName: "aria_save_document",
      args,
      approvedBySdk: true,
    });
    expect(direct).toMatchObject({
      ok: false,
      error: { code: "UNSAVED_CHANGES" },
    });

    const delegated = await invokeAgentTool({
      runtime: openDocumentRuntime,
      composerMode: "agent",
      toolName: "aria_execute_command",
      args: { command: "aria_save_document", input: args },
      approvedBySdk: true,
    });
    expect(delegated).toMatchObject({
      ok: false,
      error: { code: "UNSAVED_CHANGES" },
    });
    expect(fs.readFileSync(absolute, "utf8")).toBe(source);
  });

  it("marks all whole-document disk mutations as closed-document-only", () => {
    const descriptors = new Map(
      listAgentToolDescriptors().map((tool) => [tool.name, tool]),
    );
    for (const name of [
      "aria_save_document",
      "aria_update_layout_slots",
      "aria_delete_document",
    ]) {
      expect(descriptors.get(name)?.requiresClosedDocument).toBeTypeOf("function");
    }
  });

  it("inserts a layout slot with mtime fencing", async () => {
    const file = "src/layouts/BaseLayout.astro";
    const absolute = path.join(root, file);
    const expectedMtimeMs = Math.floor(fs.statSync(absolute).mtimeMs);
    const result = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_update_layout_slots",
      args: {
        file,
        expectedMtimeMs,
        plane: "layout",
        operation: "insert",
        slotName: "footer",
        parentPath: null,
        index: 1,
      },
      approvedBySdk: true,
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result));
    }
    expect(fs.readFileSync(absolute, "utf8")).toContain('name="footer"');
  });
});
