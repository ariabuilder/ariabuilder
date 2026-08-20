import { describe, expect, it } from "vitest";
import {
  AGENT_PARITY_MANIFEST,
  ARIA_DEMO_CANONICAL_TOOL_NAMES,
  DESKTOP_TOOL_NAMES,
} from "../../shared/agent";
import { listAgentToolDescriptors } from "./toolRegistry";

describe("desktop agent parity ledger", () => {
  it("classifies every canonical aria-demo capability exactly once", () => {
    expect(new Set(ARIA_DEMO_CANONICAL_TOOL_NAMES).size).toBe(
      ARIA_DEMO_CANONICAL_TOOL_NAMES.length,
    );
    expect(AGENT_PARITY_MANIFEST).toHaveLength(
      ARIA_DEMO_CANONICAL_TOOL_NAMES.length,
    );
    expect(new Set(AGENT_PARITY_MANIFEST.map((entry) => entry.name)).size).toBe(
      ARIA_DEMO_CANONICAL_TOOL_NAMES.length,
    );
    for (const entry of AGENT_PARITY_MANIFEST) {
      if (entry.classification.startsWith("ported_")) continue;
      expect(entry.reason).toBeTruthy();
      expect(entry.replacement).toBeTruthy();
    }
  });

  it("registers every ported desktop tool and no excluded placeholder", () => {
    const registered = new Set(listAgentToolDescriptors().map((tool) => tool.name));
    for (const name of DESKTOP_TOOL_NAMES) expect(registered.has(name)).toBe(true);
    for (const entry of AGENT_PARITY_MANIFEST) {
      if (
        entry.classification === "ported_main" ||
        entry.classification === "ported_renderer" ||
        entry.classification === "ported_partial"
      ) {
        expect(registered.has(entry.name)).toBe(true);
        if (entry.classification === "ported_partial") {
          expect(entry.reason).toBeTruthy();
          expect(entry.replacement).toBeTruthy();
        }
      } else {
        expect(registered.has(entry.name)).toBe(false);
      }
    }
    expect(registered.has("aria_execute_command")).toBe(true);
    expect(registered.has("aria_search_commands")).toBe(true);
    expect(registered.has("aria_describe_command")).toBe(true);
    expect(registered.has("aria_list_element_types")).toBe(true);
    expect(registered.has("aria_get_node_capabilities")).toBe(true);
    expect(registered.has("aria_save_entry_translation")).toBe(true);
    expect(registered.has("aria_get_entry_translation_context")).toBe(true);
  });

  it("keeps authoring tools draft-only", () => {
    const descriptors = new Map(
      listAgentToolDescriptors().map((tool) => [tool.name, tool]),
    );
    expect(
      descriptors.get("aria_create_entry")?.inputSchema.safeParse({
        collectionId: "posts",
        title: "Published bypass",
        status: "published",
      }).success,
    ).toBe(false);
    expect(
      descriptors.get("aria_update_entry")?.inputSchema.safeParse({
        collectionId: "posts",
        id: "entry-1",
        version: "v1",
        patch: { status: "published" },
      }).success,
    ).toBe(false);
    expect(
      descriptors.get("aria_import_markdown")?.inputSchema.safeParse({
        collectionId: "posts",
        markdown: "# Post",
        previewHash: "0".repeat(64),
        status: "published",
      }).success,
    ).toBe(false);
    expect(descriptors.get("aria_setup_blog")?.approvalPolicy).toBe("always");
  });
});
