import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureMutationCoordinator } from "../mutations";
import { listPaletteTemplates } from "../../shared/paletteTemplates";
import { renameClassReferences } from "../../shared/composer/renameClassReferences";
import { createAriaPrimitiveNode } from "../../shared/composer/ariaPrimitives";
import { invokeAgentTool, listAgentToolDescriptors } from "./toolRegistry";
import { getDesignSnapshot } from "../design";

describe("phase 3b shared helpers", () => {
  it("lists built-in palette templates", () => {
    const templates = listPaletteTemplates();
    expect(templates.some((item) => item.id === "minimal")).toBe(true);
    expect(templates.some((item) => item.id === "modern-blue")).toBe(true);
  });

  it("renames class tokens on an EditableNode tree", () => {
    const node = createAriaPrimitiveNode("section");
    node.props.class = { type: "string", value: "hero card" };
    const changed = renameClassReferences([node], "hero", "hero-banner");
    expect(changed).toBeGreaterThan(0);
    expect(node.props.class).toEqual({ type: "string", value: "hero-banner card" });
  });
});

describe("phase 3b wired agent tools", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase3b-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase3b-user-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "styles"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "pages", "index.astro"),
      "---\n---\n<section class=\"hero\"><h1>Home</h1></section>\n",
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

  it("registers the four phase 3b tools", () => {
    const names = new Set(listAgentToolDescriptors().map((tool) => tool.name));
    expect(names.has("aria_rename_class")).toBe(true);
    expect(names.has("upload_custom_font")).toBe(true);
    expect(names.has("aria_apply_design_system_template")).toBe(true);
    expect(names.has("aria_bind_node_field")).toBe(true);
    expect(names.has("aria_set_container_loop")).toBe(true);
  });

  it("records the source stylesheet for discovered custom classes", () => {
    fs.writeFileSync(
      path.join(root, "src", "styles", "global.css"),
      ".site-card { color: rebeccapurple; }\n",
    );
    const rule = getDesignSnapshot(root).classes.find((item) => item.name === "site-card");
    expect(rule?.source).toBe("site");
    expect(rule?.relativeFile).toBe("src/styles/global.css");
  });

  it("creates a class then renames it across project files", async () => {
    const listed = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_list_classes",
      args: {},
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    let revision = (listed.data as { revision: string }).revision;

    const created = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_create_class",
      args: { name: "hero", css: "padding: 2rem;", expectedRevision: revision },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    revision = (created.data as { revision: string }).revision;

    const dry = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_rename_class",
      args: { from: "hero", to: "hero-banner", expectedRevision: revision, dryRun: true },
      approvedBySdk: true,
    });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect((dry.data as { rewrittenFiles: string[] }).rewrittenFiles).toContain(
      "src/pages/index.astro",
    );

    const renamed = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_rename_class",
      args: { from: "hero", to: "hero-banner", expectedRevision: revision },
      approvedBySdk: true,
    });
    if (!renamed.ok) throw new Error(`rename failed: ${JSON.stringify(renamed)}`);
    expect(fs.readFileSync(path.join(root, "src", "pages", "index.astro"), "utf8")).toContain(
      "hero-banner",
    );
  });

  it("uploads a custom font from bytes and applies a palette template", async () => {
    const fonts = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_list_fonts",
      args: {},
    });
    expect(fonts.ok).toBe(true);
    if (!fonts.ok) return;
    const revision = (fonts.data as { revision: string }).revision;

    // Minimal valid-enough binary payload; importer only checks extension + non-empty bytes.
    const bytesBase64 = Buffer.from("font-bytes").toString("base64");
    const uploaded = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "upload_custom_font",
      args: {
        fileName: "brand.woff2",
        bytesBase64,
        family: "Brand Sans",
        expectedRevision: revision,
      },
      approvedBySdk: true,
    });
    expect(uploaded.ok).toBe(true);
    if (!uploaded.ok) return;
    expect(fs.existsSync(path.join(root, "public", "fonts", "brand.woff2"))).toBe(true);

    const design = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_get_design_system",
      args: {},
    });
    expect(design.ok).toBe(true);
    if (!design.ok) return;
    const designRevision = (design.data as { revision: string }).revision;

    const applied = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_apply_design_system_template",
      args: { templateId: "minimal", expectedRevision: designRevision },
      approvedBySdk: true,
    });
    expect(applied.ok).toBe(true);
  });

  it("keeps CMS bind/loop on the renderer plane", () => {
    const descriptors = new Map(
      listAgentToolDescriptors().map((tool) => [tool.name, tool]),
    );
    expect(descriptors.get("aria_bind_node_field")?.executionPlane).toBe("renderer");
    expect(descriptors.get("aria_set_container_loop")?.executionPlane).toBe("renderer");
  });
});
