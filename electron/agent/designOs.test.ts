import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureMutationCoordinator } from "../mutations";
import { writeCollections } from "../collections";
import { createEntry, getEntry } from "../cms";
import { buildAgentSystemPrompt } from "./systemPrompt";
import {
  agentToolNeedsApproval,
  describeAgentToolApproval,
  invokeAgentTool,
  listAgentToolDescriptors,
  normalizeAgentToolArguments,
  resolveAgentInvocation,
} from "./toolRegistry";
import { DeleteResourceInputSchema } from "./resources";
import {
  DESKTOP_DIRECT_TOOL_NAMES,
  LIVE_COMPOSER_DIRECT_TOOL_NAMES,
} from "./runtimeRegistry";

describe("Design OS agent surface", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-design-os-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-design-os-user-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "styles"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "src", "pages", "index.astro"),
      "---\n---\n<section><h1>Home</h1></section>\n",
    );
    configureMutationCoordinator(userData);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });

  it("keeps the system prompt free of layout recipes", () => {
    const prompt = buildAgentSystemPrompt({
      settings: {
        enabled: true,
        siteInstructions: "",
        skills: [],
        inference: { providerInstances: {} },
      } as never,
      composerMode: "agent",
      shellContext: {
        mode: "composer",
        workspace: "composer",
        itemType: "page",
        itemSlug: "/",
        itemTitle: "Home",
        pageId: "/",
        selectedBlockId: "0",
        blockCount: 2,
        canClientInsert: true,
        canClientNavigate: true,
        documentContext: {
          type: "page",
          file: "src/pages/index.astro",
          mtimeMs: 1,
          editable: true,
          dirty: false,
          emptyDocument: false,
          selectedNodePath: "0",
          selectedNodeType: "element",
          selectedNodeTag: "section",
          selectedNodeClasses: ["hero"],
          utilityStyles: {
            framework: "none",
            enabled: false,
            confidence: "none",
            sources: [],
            diagnostics: ["No Tailwind or UnoCSS project evidence found."],
          },
          outline: [
            { path: "0", type: "element", label: "section", depth: 0 },
          ],
        },
        designContext: {
          revision: "d-test",
          classCount: 1,
          paletteCount: 4,
          fontFamilyCount: 2,
        },
      },
    });

    expect(prompt).toContain("design partner");
    expect(prompt).toContain("Invent composition freely");
    expect(prompt).toContain("aria_get_design_system");
    expect(prompt).toContain("design_edit");
    expect(prompt).toContain("list_resources");
    expect(prompt).toContain("Live surface context");
    expect(prompt).toContain("If a canvas mutation reports NO_OPEN_DOCUMENT");
    expect(prompt).toContain("without narrating internal tool-by-tool deliberation");
    expect(prompt).toContain("Never fall back to aria_save_document");
    expect(prompt).toContain("do not substitute a proposed plan");
    expect(prompt).toContain("d-test");
    expect(prompt).toContain('\"utilityStyles\":{\"framework\":\"none\",\"enabled\":false');
    expect(prompt).toContain("create reusable custom CSS with aria_create_class");
    expect(prompt).not.toMatch(/3[- ]col/i);
    expect(prompt).not.toMatch(/always use/i);
    expect(prompt).not.toMatch(/pricing-v2/i);
    expect(prompt).not.toMatch(/full-bleed with CTA left/i);
    expect(prompt).not.toMatch(/section patterns?/i);
  });

  it("registers design_edit and admin resource verbs", () => {
    const names = new Set(listAgentToolDescriptors().map((tool) => tool.name));
    expect(names.has("design_edit")).toBe(true);
    expect(names.has("list_resources")).toBe(true);
    expect(names.has("get_resource")).toBe(true);
    expect(names.has("create_resource")).toBe(true);
    expect(names.has("apply_resource_patch")).toBe(true);
    expect(names.has("delete_resource")).toBe(true);
  });

  it("keeps the direct set at or under 22 tools", () => {
    const count =
      DESKTOP_DIRECT_TOOL_NAMES.length + LIVE_COMPOSER_DIRECT_TOOL_NAMES.length;
    expect(count).toBe(21);
    expect(count).toBeLessThanOrEqual(22);
  });

  it("routes design_edit class_create through revision fencing", async () => {
    const runtime = {
      projectPath: root,
      userData,
      webContentsId: 1,
    };
    const snapshot = await invokeAgentTool({
      runtime,
      composerMode: "agent",
      toolName: "aria_get_design_system",
      args: {},
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const revision = String((snapshot.data as { revision: string }).revision);

    const conflict = await invokeAgentTool({
      runtime,
      composerMode: "agent",
      toolName: "design_edit",
      args: {
        action: "class_create",
        name: "hero-title",
        css: "font-size: 2rem;",
        expectedRevision: "d-stale",
      },
    });
    expect(conflict.ok).toBe(false);

    const created = await invokeAgentTool({
      runtime,
      composerMode: "agent",
      toolName: "design_edit",
      args: {
        action: "class_create",
        name: "hero-title",
        css: "font-size: 2rem;",
        expectedRevision: revision,
      },
    });
    expect(created.ok).toBe(true);
  });

  it("lists pages through list_resources", async () => {
    const listed = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "list_resources",
      args: { type: "page" },
    });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(JSON.stringify(listed.data)).toContain("src/pages/index.astro");
  });

  it("delegates typed resource creates to the concrete executor", async () => {
    const created = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "create_resource",
      args: { type: "page", data: { name: "about" } },
    });
    expect(created.ok).toBe(true);
    expect(fs.existsSync(path.join(root, "src", "pages", "about.astro"))).toBe(
      true,
    );
  });

  it("returns route metadata when duplicating a page document", async () => {
    const duplicated = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "aria_duplicate_document",
      args: {
        kind: "page",
        sourceFile: "src/pages/index.astro",
        name: "about-copy",
      },
    });
    expect(duplicated).toMatchObject({
      ok: true,
      data: {
        kind: "page",
        file: "src/pages/about-copy.astro",
        route: "/about-copy",
      },
    });
    expect(JSON.stringify(duplicated)).not.toContain('"name"');
  });

  it("resolves nested destructive resources before approval and execution", async () => {
    writeCollections(root, {
      collections: [
        {
          id: "posts",
          name: "posts",
          label: "Posts",
          kind: "content",
          urlPattern: "/posts/{slug}",
          listPageFile: null,
          templatePageFile: null,
          supports: ["body", "drafts", "revisions"],
          scope: "global",
          schema: { fields: [], version: 1 },
        },
      ],
    });
    const entry = createEntry(root, {
      collectionId: "posts",
      title: "Delete me",
    });
    const args = {
      command: "delete_resource",
      input: {
        type: "entry",
        id: entry.entry.id,
        collectionId: "posts",
        version: entry.entry.version,
      },
    };

    expect(agentToolNeedsApproval("aria_execute_command", args)).toBe(true);
    expect(describeAgentToolApproval("aria_execute_command", args)).toMatchObject({
      category: "delete_content",
    });
    const normalized = normalizeAgentToolArguments("aria_execute_command", args);
    expect(normalized).toMatchObject({
      ok: true,
      value: {
        outer: { toolName: "aria_execute_command" },
        target: { toolName: "aria_delete_entry" },
      },
    });
    const resolved = resolveAgentInvocation("aria_execute_command", args);
    expect(resolved.ok && resolved.value.descriptor).toMatchObject({
      name: "aria_delete_entry",
      mutationBoundary: "cms",
      blocksOnDirtyCms: true,
    });

    const blocked = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "aria_execute_command",
      args,
    });
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: "CONFIRMATION_REQUIRED" },
    });
    expect(getEntry(root, "posts", entry.entry.id)).not.toBeNull();

    const stale = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "aria_execute_command",
      args: {
        ...args,
        input: { ...args.input, version: "stale-version" },
      },
      approvedBySdk: true,
    });
    expect(stale).toMatchObject({
      ok: false,
      error: { code: "VERSION_CONFLICT" },
    });
    expect(getEntry(root, "posts", entry.entry.id)).not.toBeNull();

    const deleted = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "aria_execute_command",
      args,
      approvedBySdk: true,
    });
    expect(deleted.ok).toBe(true);
    expect(getEntry(root, "posts", entry.entry.id)).toBeNull();
  });

  it("requires entry delete versions and preserves the dirty CMS guard through resources", async () => {
    expect(
      DeleteResourceInputSchema.safeParse({
        type: "entry",
        id: "entry-1",
        collectionId: "posts",
      }).success,
    ).toBe(false);

    const dirty = await invokeAgentTool({
      runtime: {
        projectPath: root,
        userData,
        webContentsId: 1,
        shellContext: {
          cmsContext: { dirty: true },
        } as never,
      },
      composerMode: "agent",
      toolName: "apply_resource_patch",
      args: {
        type: "entry",
        patch: {
          collectionId: "posts",
          id: "entry-1",
          version: "v1",
          patch: { title: "Changed" },
        },
      },
    });
    expect(dirty).toMatchObject({
      ok: false,
      error: { code: "UNSAVED_CHANGES" },
    });
  });

  it("keeps Ask-mode command discovery read-only", async () => {
    const searched = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "ask",
      toolName: "aria_search_commands",
      args: { query: "delete entry", limit: 25 },
    });
    expect(searched.ok).toBe(true);
    expect(JSON.stringify(searched)).not.toContain("aria_delete_entry");
  });

  it("persists only revision-fenced hex primary colors", async () => {
    const snapshot = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "ask",
      toolName: "aria_get_design_system",
      args: {},
    });
    expect(snapshot.ok).toBe(true);
    if (!snapshot.ok) return;
    const revision = String((snapshot.data as { revision: string }).revision);

    const named = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "design_edit",
      args: { action: "set_primary_color", color: "red", expectedRevision: revision },
    });
    expect(named).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });

    const changed = await invokeAgentTool({
      runtime: { projectPath: root, userData, webContentsId: 1 },
      composerMode: "agent",
      toolName: "design_edit",
      args: {
        action: "set_primary_color",
        color: "12abef",
        expectedRevision: revision,
      },
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    const primary = (changed.data as {
      design: { colors: { palettes: Array<{ id: string; shades: Record<string, string> }> } };
    }).design.colors.palettes.find((palette) => palette.id === "primary");
    expect(primary?.shades.DEFAULT).toBe("#12abef");
    expect(primary?.shades["500"]).toBe("#12abef");
  });
});
