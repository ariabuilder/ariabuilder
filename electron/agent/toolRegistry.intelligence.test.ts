import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { asSchema } from "@ai-sdk/provider-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DESKTOP_DIRECT_TOOL_NAMES,
  LIVE_COMPOSER_DIRECT_TOOL_NAMES,
} from "./runtimeRegistry";
import { buildDesktopAiTools } from "./tools";
import { invokeAgentTool, listAgentToolDescriptors } from "./toolRegistry";

describe("desktop agent intelligence and policy", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-project-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-user-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(userData, { recursive: true, force: true });
  });

  const runtime = () => ({
    projectPath: root,
    userData,
    webContentsId: 1,
    rendererCapabilities: { navigation: true, document: false },
  });

  it("searches session-available commands and describes executable schemas", async () => {
    const searched = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_search_commands",
      args: { query: "translation", limit: 5 },
    });
    expect(searched.ok).toBe(true);
    expect(JSON.stringify(searched)).toContain("aria_get_entry_translation_context");

    const described = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_describe_command",
      args: { name: "aria_get_entry_translation_context" },
    });
    expect(described.ok).toBe(true);
    expect(described.ok && described.data).toMatchObject({
      command: "aria_get_entry_translation_context",
      mutation: "read",
    });
    expect(described.ok && (described.data as { inputSchema?: unknown }).inputSchema).toBeTruthy();
    expect(listAgentToolDescriptors().some((tool) => tool.name === "aria_execute_command")).toBe(true);
  });

  it("keeps the parity ledger search available for engineering introspection", async () => {
    const searched = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_search_capabilities",
      args: { query: "translation", limit: 5 },
    });
    expect(searched.ok).toBe(true);
    expect(JSON.stringify(searched)).toContain("aria_save_entry_translation");
  });

  it("keeps risky Composer operations confirmed and Ask mode read-only", async () => {
    const descriptors = new Map(listAgentToolDescriptors().map((tool) => [tool.name, tool]));
    expect(descriptors.get("aria_delete_node")?.risk).toBe("delete_content");
    expect(descriptors.get("aria_replace_node")?.risk).toBe("replace_content");

    const result = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_mutate_node",
      args: { path: "0", operation: "set_text", value: "Changed" },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: "INVALID_INPUT" },
    });
  });

  it("exposes a Design OS direct tool profile under 22 tools", () => {
    const live = buildDesktopAiTools({
      deps: {
        ...runtime(),
        rendererCapabilities: { navigation: true, document: true },
        executeRendererTool: async () => ({ ok: true, data: {} }),
        shellContext: {
          workspace: "composer",
          canClientInsert: true,
          documentContext: { editable: true, file: "src/pages/index.astro" },
        } as never,
      },
      composerMode: "agent",
    });
    const names = Object.keys(live);
    expect(names.length).toBeLessThanOrEqual(22);
    expect(names).toContain("insert_nodes");
    expect(names).toContain("aria_get_design_system");
    expect(names).toContain("aria_list_element_types");
    expect(names).toContain("aria_search_commands");
    expect(names).toContain("aria_execute_command");
    expect(names).toContain("aria_get_node_condition");
    expect(names).toContain("aria_set_node_condition");
    expect(names).toContain("aria_remove_node_condition");
    expect(names).not.toContain("aria_insert_nodes");
    expect(names).not.toContain("aria_list_media");
    expect(names).not.toContain("design_edit");
    expect(names).not.toContain("aria_save_entry_translation");

    // A workspace navigation host keeps canvas tools direct before a document
    // opens, so open→insert works without rebuilding the tool profile.
    const cold = buildDesktopAiTools({
      deps: {
        ...runtime(),
        rendererCapabilities: { navigation: true, document: false },
        shellContext: { workspace: "studio", canClientInsert: false } as never,
      },
      composerMode: "agent",
    });
    expect(Object.keys(cold)).toContain("insert_nodes");
    expect(Object.keys(cold)).toContain("open_in_composer");
    expect(Object.keys(cold).length).toBeLessThanOrEqual(22);

    const disconnected = buildDesktopAiTools({
      deps: {
        ...runtime(),
        rendererCapabilities: { navigation: false, document: false },
        shellContext: { workspace: "studio", canClientInsert: false } as never,
      },
      composerMode: "agent",
    });
    expect(Object.keys(disconnected)).not.toContain("open_in_composer");
    expect(Object.keys(disconnected)).not.toContain("insert_nodes");

    const maxDirect =
      DESKTOP_DIRECT_TOOL_NAMES.length + LIVE_COMPOSER_DIRECT_TOOL_NAMES.length;
    expect(maxDirect).toBeLessThanOrEqual(22);
  });

  it("ranks canvas tools ahead of discovery within the direct set", () => {
    const tools = buildDesktopAiTools({
      deps: {
        ...runtime(),
        rendererCapabilities: { navigation: true, document: true },
        executeRendererTool: async () => ({ ok: true, data: {} }),
        shellContext: {
          workspace: "composer",
          canClientInsert: true,
          documentContext: { editable: true, file: "src/pages/index.astro" },
        } as never,
      },
      composerMode: "agent",
    });
    const names = Object.keys(tools);
    expect(names).toContain("aria_mutate_node");
    expect(names.indexOf("insert_nodes")).toBeLessThan(
      names.indexOf("aria_search_commands"),
    );
  });

  it("publishes object-rooted JSON schemas for every provider function tool", async () => {
    for (const descriptor of listAgentToolDescriptors()) {
      const schema = await asSchema(descriptor.inputSchema).jsonSchema;
      expect(schema.type, descriptor.name).toBe("object");
    }
  });

  it("preserves operation-specific mutate-node validation", () => {
    const schema = listAgentToolDescriptors().find(
      (descriptor) => descriptor.name === "aria_mutate_node",
    )?.inputSchema;
    expect(schema).toBeDefined();

    expect(
      schema?.safeParse({
        path: "0",
        operation: "set_prop",
        propName: "aria-label",
        value: { type: "string", value: "Introduction" },
      }).success,
    ).toBe(true);
    expect(
      schema?.safeParse({
        path: "0",
        operation: "set_prop",
        propName: "aria-label",
        value: "Introduction",
      }).success,
    ).toBe(false);
    expect(
      schema?.safeParse({
        path: "0",
        operation: "remove_prop",
        propName: "aria-label",
        value: { type: "bare" },
      }).success,
    ).toBe(false);

    const tag = schema?.safeParse({
      path: "0",
      operation: "set_tag",
      value: "  section  ",
    });
    expect(tag?.success).toBe(true);
    expect(tag?.success && (tag.data as { value: string }).value).toBe("section");
  });

  it("accepts semantic insert payloads in the provider schema", () => {
    const descriptor = listAgentToolDescriptors().find(
      (descriptor) => descriptor.name === "insert_nodes",
    );
    const schema = descriptor?.inputSchema;
    expect(
      schema?.safeParse({
        nodes: [{ tag: "section", children: [{ type: "h1", text: "Hero" }] }],
      }).success,
    ).toBe(true);
    expect(
      schema?.safeParse({
        nodes: [{ primitive: "section" }],
        target: { parentPath: null, index: 0 },
      }).success,
    ).toBe(true);
    expect(descriptor?.description).toContain("exact paths from the current Layers outline");
    expect(descriptor?.description).toContain("omit target");
    expect(descriptor?.description).toContain("document.utilityStyles.enabled");
  });

  it("validates flat AND/OR condition tool payloads", () => {
    const schema = listAgentToolDescriptors().find(
      (descriptor) => descriptor.name === "aria_set_node_condition",
    )?.inputSchema;
    expect(schema?.safeParse({
      path: "0",
      condition: {
        version: 1,
        groups: [{
          id: "paid",
          rules: [{
            id: "plan",
            source: { provider: "component", path: ["plan"] },
            operator: "equals",
            value: "pro",
          }],
        }],
      },
      otherwise: true,
    }).success).toBe(true);
    expect(schema?.safeParse({
      path: "0",
      condition: { version: 1, groups: [{ id: "empty", rules: [] }] },
    }).success).toBe(false);
  });

  it("rotates the redacted activity log before appending", async () => {
    const directory = path.join(userData, "agent");
    fs.mkdirSync(directory, { recursive: true });
    const file = path.join(directory, "activity.jsonl");
    fs.writeFileSync(file, Buffer.alloc(2 * 1024 * 1024, 0x20));

    await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_describe_capability",
      args: { name: "aria_get_site_context" },
    });

    expect(fs.statSync(`${file}.1`).size).toBe(2 * 1024 * 1024);
    expect(fs.readFileSync(file, "utf8")).toContain("aria_describe_capability");
  });
});
