import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScanComponent, ScanPage } from "../../shared/types";
import {
  buildLayoutPreviewInventory,
  chooseLayoutRepresentativeRoute,
} from "../layoutPreview";

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "aria-layout-preview-"));
  mkdirSync(path.join(root, "src/layouts"), { recursive: true });
  mkdirSync(path.join(root, "src/pages/blog"), { recursive: true });
  const layouts: ScanComponent[] = [
    { id: "src/layouts/Base.astro", name: "Base", file: "src/layouts/Base.astro", mtimeMs: 10 },
    { id: "src/layouts/Unused.astro", name: "Unused", file: "src/layouts/Unused.astro", mtimeMs: 20 },
  ];
  const pages: ScanPage[] = [
    { route: "/", file: "src/pages/index.astro", mtimeMs: 30, title: "Home" },
    { route: "/blog/one", file: "src/pages/blog/one.astro", mtimeMs: 50 },
    { route: "/broken", file: "src/pages/broken.astro", mtimeMs: 60 },
  ];
  writeFileSync(
    path.join(root, layouts[0]!.file),
    `---\ninterface Props {\n  title: string;\n  data: unknown;\n}\nconst { title, data } = Astro.props;\n---\n<html><body><header><slot name="header" /></header><main><slot /></main><aside><slot name="sidebar"><p>Fallback</p></slot></aside></body></html>`,
  );
  writeFileSync(path.join(root, layouts[1]!.file), `---\n---\n<section><p>No slot</p></section>`);
  writeFileSync(path.join(root, pages[0]!.file), `---\nimport Shell from '@/layouts/Base.astro';\n---\n<Shell><main>Home</main></Shell>`);
  writeFileSync(path.join(root, pages[1]!.file), `---\nimport Shell from '../../layouts/Base.astro';\n---\n<Shell><main>Post</main></Shell>`);
  writeFileSync(path.join(root, pages[2]!.file), `---\nconst nope = ;\n---\n<p>Broken</p>`);
  return { root, layouts, pages };
}

describe("layout preview inventory", () => {
  it("parses pages once into consumers and exposes slot diagnostics", async () => {
    const { root, layouts, pages } = fixture();
    const result = await buildLayoutPreviewInventory(root, { layouts, pages });
    expect(result[0]!.consumers.map((consumer) => consumer.route)).toEqual(["/", "/blog/one"]);
    expect(result[0]!.representativeRoute).toBe("/");
    expect(result[0]!.slots.map((slot) => slot.name)).toEqual(["header", null, "sidebar"]);
    expect(result[0]!.diagnostics).toContain(
      "Required prop data needs a value before the standalone preview can render it.",
    );
    expect(result[1]).toMatchObject({
      consumers: [],
      representativeRoute: null,
      diagnostics: ["No Page content slot found."],
    });
  });

  it("chooses home, then newest previewable route with a stable tie-break", () => {
    expect(
      chooseLayoutRepresentativeRoute([
        { route: "/new-b", file: "b.astro", mtimeMs: 20, previewable: true },
        { route: "/new-a", file: "a.astro", mtimeMs: 20, previewable: true },
        { route: "/[slug]", file: "dynamic.astro", mtimeMs: 40, previewable: false },
      ]),
    ).toBe("/new-a");
    expect(
      chooseLayoutRepresentativeRoute([
        { route: "/other", file: "other.astro", mtimeMs: 100, previewable: true },
        { route: "/", file: "index.astro", mtimeMs: 1, previewable: true },
      ]),
    ).toBe("/");
  });

  it("surfaces dynamic and duplicate slot contracts without blocking other layouts", async () => {
    const { root, layouts, pages } = fixture();
    const invalid: ScanComponent = {
      id: "src/layouts/Invalid.astro",
      name: "Invalid",
      file: "src/layouts/Invalid.astro",
      mtimeMs: 30,
    };
    writeFileSync(
      path.join(root, invalid.file),
      `---\nconst slotName = 'sidebar';\n---\n<slot name={slotName} /><slot /><slot />`,
    );
    const result = await buildLayoutPreviewInventory(root, {
      layouts: [...layouts, invalid],
      pages,
    });
    const manifest = result.find((entry) => entry.layout.id === invalid.id)!;
    expect(manifest.diagnostics.some((message) => message.includes("Dynamic slot"))).toBe(true);
    expect(manifest.diagnostics.some((message) => message.includes("duplicated"))).toBe(true);
  });
});
