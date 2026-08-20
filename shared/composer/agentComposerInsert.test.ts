/**
 * First-attempt Composer insertion harness + flushSave boundary.
 */
import { describe, expect, it, vi } from "vitest";
import {
  applyAgentComposerInsert,
  prepareAgentComposerInsert,
  resolveAgentComposerInsertPlacement,
  runAgentComposerInsertBoundary,
} from "./agentComposerInsert";
import { applyAgentNodeClassUpdate } from "./agentNodeClasses";
import { createAriaPrimitiveNode } from "./ariaPrimitives";
import { insertNodesAt } from "./mutate";
import { parseAstro } from "./parseAstro";
import { serializeAstro } from "./serializeAstro";
import type { AstroDocumentModel } from "./types";

function blankModel(): AstroDocumentModel {
  return {
    imports: [],
    extraFrontmatter: "",
    nodes: [],
    propSchema: [],
    slots: [],
    extendsTag: null,
  };
}

async function modelFor(source: string): Promise<AstroDocumentModel> {
  const result = await parseAstro(source);
  expect(result.editable).toBe(true);
  if (!result.editable) throw new Error("expected editable source");
  return result.model;
}

const PAGE_SOURCE = `---\n---\n<!doctype html>
<html><head><title>Test</title></head><body>
  <header>Header</header><main><p>Existing</p></main><footer>Footer</footer>
</body></html>`;

describe("first-attempt Composer insertion harness", () => {
  it("inserts a hero section from a primitive payload on the first attempt", () => {
    const prepared = prepareAgentComposerInsert([{ primitive: "section" }]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const model = blankModel();
    const result = insertNodesAt(model, prepared.nodes, {
      parentPath: null,
      index: 0,
    });
    expect(result.ok).toBe(true);
    const baseline = blankModel();
    insertNodesAt(baseline, [createAriaPrimitiveNode("section")], {
      parentPath: null,
      index: 0,
    });
    const stripIds = (source: string) =>
      source.replace(/data-aria-path="[^"]*"/g, "").replace(/\s+/g, " ").trim();
    expect(stripIds(serializeAstro(model))).toBe(stripIds(serializeAstro(baseline)));
  });

  it("awaits flushSave after a successful normalize→insert boundary", async () => {
    const model = blankModel();
    const flushSave = vi.fn(async () => undefined);
    const outcome = await runAgentComposerInsertBoundary({
      model,
      supplied: [
        {
          tag: "section",
          className: "hero",
          children: [{ type: "h1", text: "Welcome" }],
        },
      ],
      mutateModel: (fn) => {
        const result = fn(model);
        return result.ok !== false;
      },
      flushSave,
    });
    expect(outcome).toMatchObject({
      ok: true,
      fileSaved: true,
      nodeCount: 1,
      placement: {
        requestedTarget: null,
        resolvedTarget: { parentPath: null, index: 0 },
        normalized: false,
      },
    });
    expect(flushSave).toHaveBeenCalledTimes(1);
    expect(serializeAstro(model)).toContain('class="hero"');
    expect(serializeAstro(model)).toContain("<h1>Welcome</h1>");
  });

  it("normalizes a full-page root target into the start of the unique main", async () => {
    const model = await modelFor(PAGE_SOURCE);
    const prepared = prepareAgentComposerInsert([{ tag: "section", children: ["Hero"] }]);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const result = applyAgentComposerInsert({
      model,
      nodes: prepared.nodes,
      target: { parentPath: null, index: 0 },
    });
    expect(result).toMatchObject({
      ok: true,
      selectPath: "1.1.1.0",
      placement: {
        requestedTarget: { parentPath: null, index: 0 },
        resolvedTarget: { parentPath: "1.1.1", index: 0 },
        normalized: true,
        reason: "document-root-to-primary-content",
      },
    });
    const serialized = serializeAstro(model);
    expect(serialized.toLowerCase().indexOf("<!doctype html>")).toBeLessThan(serialized.indexOf("Hero"));
    expect(serialized.indexOf("Hero")).toBeLessThan(serialized.indexOf("Existing"));
  });

  it.each(["0", "1", "1.0"])(
    "normalizes document-shell target %s into the unique main",
    async (parentPath) => {
      const model = await modelFor(PAGE_SOURCE);
      expect(resolveAgentComposerInsertPlacement({
        model,
        target: { parentPath, index: 4 },
      })).toMatchObject({
        requestedTarget: { parentPath, index: 4 },
        resolvedTarget: { parentPath: "1.1.1", index: 4 },
        normalized: true,
        reason: "document-shell-to-primary-content",
      });
    },
  );

  it("normalizes an existing orphan target but rejects stale paths", async () => {
    const model = await modelFor(`---\n---\n<aside>Orphan</aside><!doctype html>
<html><head><title>Test</title></head><body>
  <header>Header</header><main><p>Existing</p></main><footer>Footer</footer>
</body></html>`);
    expect(resolveAgentComposerInsertPlacement({
      model,
      target: { parentPath: "0", index: 2 },
    })).toMatchObject({
      resolvedTarget: { parentPath: "1.1.1", index: 2 },
      normalized: true,
      reason: "outside-content-to-primary-content",
    });
    expect(resolveAgentComposerInsertPlacement({
      model,
      target: { parentPath: "99", index: 0 },
    })).toBeNull();
    expect(resolveAgentComposerInsertPlacement({
      model,
      target: { parentPath: "1.1.99", index: 0 },
    })).toBeNull();
  });

  it("keeps valid Content targets and selection-relative placement unchanged", async () => {
    const model = await modelFor(PAGE_SOURCE);
    expect(resolveAgentComposerInsertPlacement({
      model,
      target: { parentPath: "1.1", index: 1 },
    })).toEqual({
      requestedTarget: { parentPath: "1.1", index: 1 },
      resolvedTarget: { parentPath: "1.1", index: 1 },
      normalized: false,
    });
    expect(resolveAgentComposerInsertPlacement({
      model,
      selectedPath: "1.1.1",
    })).toEqual({
      requestedTarget: null,
      resolvedTarget: { parentPath: "1.1.1", index: 1 },
      normalized: false,
    });
  });

  it("prefers main only for inferred fallback placement", async () => {
    const model = await modelFor(PAGE_SOURCE);
    expect(resolveAgentComposerInsertPlacement({ model })).toEqual({
      requestedTarget: null,
      resolvedTarget: { parentPath: "1.1.1", index: 1 },
      normalized: false,
    });
    expect(resolveAgentComposerInsertPlacement({ model, selectedPath: "1.0" })).toEqual({
      requestedTarget: null,
      resolvedTarget: { parentPath: "1.1.1", index: 1 },
      normalized: false,
    });
  });

  it("falls back to the body when main is absent or ambiguous", async () => {
    const noMain = await modelFor(`<!doctype html><html><head></head><body><section>A</section></body></html>`);
    expect(resolveAgentComposerInsertPlacement({ model: noMain })).toMatchObject({
      resolvedTarget: { parentPath: "1.1", index: 1 },
    });
    const ambiguous = await modelFor(`<!doctype html><html><head></head><body><main>A</main><main>B</main></body></html>`);
    expect(resolveAgentComposerInsertPlacement({ model: ambiguous })).toMatchObject({
      resolvedTarget: { parentPath: "1.1", index: 2 },
    });
  });

  it("retains root insertion for fragment components", async () => {
    const model = await modelFor(`<section>One</section>`);
    expect(resolveAgentComposerInsertPlacement({
      model,
      target: { parentPath: null, index: 0 },
    })).toEqual({
      requestedTarget: { parentPath: null, index: 0 },
      resolvedTarget: { parentPath: null, index: 0 },
      normalized: false,
    });
  });

  it("rejects invalid containment atomically without saving", async () => {
    const model = await modelFor(PAGE_SOURCE);
    const before = serializeAstro(model);
    const flushSave = vi.fn(async () => undefined);
    const outcome = await runAgentComposerInsertBoundary({
      model,
      supplied: [{ tag: "section", children: ["Invalid inside p"] }],
      target: { parentPath: "1.1.1.0", index: 0 },
      mutateModel: (fn) => fn(model).ok,
      flushSave,
    });
    expect(outcome).toMatchObject({ ok: false, message: "Invalid containment for section" });
    expect(serializeAstro(model)).toBe(before);
    expect(flushSave).not.toHaveBeenCalled();
  });

  it("applies breakpoint-aware class updates", () => {
    const props = { class: { type: "string" as const, value: "flex hidden" } };
    const updated = applyAgentNodeClassUpdate(props, {
      add: ["md:grid", "lg:gap-8"],
      remove: ["hidden"],
      classNames: { base: ["items-center"], md: ["grid-cols-2"] },
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    // classNames flatten first, then add, then remove.
    expect(updated.tokens).toEqual([
      "flex",
      "items-center",
      "md:grid-cols-2",
      "md:grid",
      "lg:gap-8",
    ]);
  });
});
