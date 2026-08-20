import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configureMutationCoordinator } from "../mutations";
import { invokeAgentTool } from "./toolRegistry";

describe("phase 2 wired desktop agent tools", () => {
  let root = "";
  let userData = "";

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase2-"));
    userData = fs.mkdtempSync(path.join(os.tmpdir(), "aria-agent-phase2-user-"));
    fs.writeFileSync(path.join(root, "package.json"), "{}\n");
    fs.mkdirSync(path.join(root, "src", "pages"), { recursive: true });
    fs.mkdirSync(path.join(root, "src", "layouts"), { recursive: true });
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

  const runtime = () => ({
    projectPath: root,
    userData,
    webContentsId: 1,
  });

  it("lists element types and node capabilities", async () => {
    const types = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_list_element_types",
      args: {},
    });
    expect(types.ok).toBe(true);
    expect(JSON.stringify(types)).toContain("section");

    const caps = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_get_node_capabilities",
      args: {},
    });
    expect(caps.ok).toBe(true);
    expect(JSON.stringify(caps)).toContain("motion");
  });

  it("creates a layout through the workspace service", async () => {
    const created = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_create_layout",
      args: { name: "MarketingLayout" },
    });
    if (!created.ok) {
      throw new Error(JSON.stringify(created));
    }
    expect(fs.existsSync(path.join(root, "src", "layouts", "MarketingLayout.astro"))).toBe(
      true,
    );
  });

  it("returns richer site context", async () => {
    const context = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_get_site_context",
      args: {},
    });
    expect(context.ok).toBe(true);
    expect(JSON.stringify(context)).toContain("pages");
    expect(JSON.stringify(context)).toContain("capabilities");
  });

  it("advertises responsive class authoring capabilities", async () => {
    const caps = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_get_node_capabilities",
      args: {},
    });
    expect(caps.ok).toBe(true);
    expect(JSON.stringify(caps)).toContain("responsiveClassNames");
  });

  it("requires expectedRevision before applying a design-system patch", async () => {
    const missing = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_apply_design_system_patch",
      args: { patch: {} },
      approvedBySdk: true,
    });
    expect(missing.ok).toBe(false);

    const current = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "ask",
      toolName: "aria_get_design_system",
      args: {},
    });
    expect(current.ok).toBe(true);
    if (!current.ok) return;
    const revision = (current.data as { revision?: string }).revision;
    expect(typeof revision).toBe("string");

    const conflict = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_apply_design_system_patch",
      args: { patch: {}, expectedRevision: "stale-revision" },
      approvedBySdk: true,
    });
    expect(conflict.ok).toBe(false);
    expect(JSON.stringify(conflict)).toContain("CONFLICT");

    const applied = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_apply_design_system_patch",
      args: { patch: {}, expectedRevision: revision },
      approvedBySdk: true,
    });
    expect(applied.ok).toBe(true);
  });

  it("executes a read command through the typed bridge", async () => {
    const result = await invokeAgentTool({
      runtime: runtime(),
      composerMode: "agent",
      toolName: "aria_execute_command",
      args: { command: "aria_list_element_types", input: {} },
    });
    if (!result.ok) {
      throw new Error(JSON.stringify(result));
    }
    expect(JSON.stringify(result)).toContain("primitives");
  });
});

