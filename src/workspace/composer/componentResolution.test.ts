import { describe, expect, it } from "vitest";
import { resolveComposerComponentFallback } from "./componentResolution";

const candidates = [
  {
    name: "Hero",
    file: "src/components/Sections/About/Hero.astro",
    kind: "component" as const,
  },
  {
    name: "Hero",
    file: "src/components/Sections/Home/Hero.astro",
    kind: "component" as const,
  },
  {
    name: "BaseLayout",
    file: "src/layouts/BaseLayout.astro",
    kind: "layout" as const,
  },
];

describe("Composer component fallback resolution", () => {
  it("uses a unique normalized import suffix before the duplicate display name", () => {
    expect(
      resolveComposerComponentFallback({
        name: "Hero",
        importSpec: "@components/Sections/Home/Hero.astro",
        candidates,
      }),
    ).toMatchObject({
      status: "resolved",
      method: "import-suffix",
      candidate: {
        file: "src/components/Sections/Home/Hero.astro",
      },
    });
  });

  it("refuses an ambiguous name-only fallback", () => {
    expect(
      resolveComposerComponentFallback({
        name: "Hero",
        importSpec: "virtual:Hero",
        candidates,
      }),
    ).toEqual({
      status: "ambiguous",
      candidates: candidates.slice(0, 2),
    });
  });

  it("retains a unique name fallback", () => {
    expect(
      resolveComposerComponentFallback({
        name: "BaseLayout",
        candidates,
      }),
    ).toMatchObject({
      status: "resolved",
      method: "name",
      candidate: { file: "src/layouts/BaseLayout.astro" },
    });
  });

  it("returns unresolved without changing candidate identity", () => {
    expect(
      resolveComposerComponentFallback({
        name: "Missing",
        importSpec: "@components/Missing.astro",
        candidates,
      }),
    ).toEqual({ status: "unresolved", candidates: [] });
  });
});
