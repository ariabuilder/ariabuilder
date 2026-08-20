import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  deleteStudioDocument,
  duplicateStudioDocument,
  inspectStudioComponent,
} from "./documents";

const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), "aria-studio-documents-"));
  roots.push(root);
  for (const directory of ["src/components", "src/layouts", "src/pages"]) {
    mkdirSync(path.join(root, directory), { recursive: true });
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Studio document inspection", () => {
  it("projects Astro props, slots, structure, and structured usages", async () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "src/components/Hero.astro"),
      `---\ninterface Props { title: string; tone?: "calm" | "bold" }\nconst { title, tone = "calm" } = Astro.props\n---\n<section><h1>{title}</h1><slot name="actions" /></section>`,
    );
    writeFileSync(
      path.join(root, "src/pages/index.astro"),
      `---\nimport Hero from "../components/Hero.astro"\n---\n<Hero title="Hello" />`,
    );

    const manifest = await inspectStudioComponent(root, "src/components/Hero.astro");

    expect(manifest.props.map((field) => field.name)).toEqual(["title", "tone"]);
    expect(manifest.slots).toEqual(["actions"]);
    expect(manifest.structure[0]?.label).toBe("Section");
    expect(manifest.usages).toEqual([
      expect.objectContaining({
        kind: "page",
        file: "src/pages/index.astro",
        route: "/",
        referenceCount: 1,
      }),
    ]);
    expect(manifest.diagnostics).toEqual([]);
  });

  it("returns a diagnostic for supported non-Astro inventory components", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "src/components/Widget.tsx"), "export default function Widget() { return null }");

    const manifest = await inspectStudioComponent(root, "src/components/Widget.tsx");

    expect(manifest.props).toEqual([]);
    expect(manifest.structure).toEqual([]);
    expect(manifest.diagnostics[0]).toContain("not visually editable as Astro");
  });
});

describe("Studio document lifecycle", () => {
  it("duplicates exact bytes without overwriting an existing destination", () => {
    const root = fixture();
    const source = path.join(root, "src/components/Hero.astro");
    writeFileSync(source, "---\n---\n<section>Hero</section>\n");

    const created = duplicateStudioDocument(root, {
      kind: "component",
      file: "src/components/Hero.astro",
      name: "marketing/Hero Copy",
    });

    expect(created.file).toBe("src/components/marketing/Hero-Copy.astro");
    expect(readFileSync(path.join(root, created.file), "utf8")).toBe(
      readFileSync(source, "utf8"),
    );
    expect(() =>
      duplicateStudioDocument(root, {
        kind: "component",
        file: "src/components/Hero.astro",
        name: "marketing/Hero Copy",
      }),
    ).toThrow("already exists");
  });

  it("rechecks dependencies before deleting components and layouts", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "src/components/Hero.astro"), "---\n---\n<section>Hero</section>");
    writeFileSync(path.join(root, "src/layouts/Base.astro"), "---\n---\n<html><body><slot /></body></html>");
    writeFileSync(
      path.join(root, "src/pages/index.astro"),
      `---\nimport Hero from "../components/Hero.astro"\nimport Base from "../layouts/Base.astro"\n---\n<Base><Hero /></Base>`,
    );

    await expect(
      deleteStudioDocument(root, { kind: "component", file: "src/components/Hero.astro" }),
    ).resolves.toMatchObject({ ok: false, code: "DOCUMENT_IN_USE" });
    await expect(
      deleteStudioDocument(root, { kind: "layout", file: "src/layouts/Base.astro" }),
    ).resolves.toMatchObject({ ok: false, code: "DOCUMENT_IN_USE" });
  });
});
