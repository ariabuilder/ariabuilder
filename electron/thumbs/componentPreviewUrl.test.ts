import { describe, expect, it } from "vitest";
import { COMPONENT_THUMB_VERSION } from "../componentPreviewHarness";
import {
  buildComponentPreviewUrl,
  componentPreviewReadyScript,
} from "./componentPreviewUrl";

describe("buildComponentPreviewUrl", () => {
  it("selects the catalog target with an id query param", () => {
    const url = buildComponentPreviewUrl(
      "http://127.0.0.1:4321/",
      "src/components/Hero.astro",
      99,
    );
    expect(url).toBe(
      "http://127.0.0.1:4321/__aria/component-thumbnail?id=src%2Fcomponents%2FHero.astro&t=99",
    );
  });

  it("rejects non-local bases and unsafe ids", () => {
    expect(
      buildComponentPreviewUrl("https://example.com/", "src/components/Hero.astro"),
    ).toBeNull();
    expect(
      buildComponentPreviewUrl(
        "http://127.0.0.1:4321/",
        "src/components/../layouts/Main.astro",
      ),
    ).toBeNull();
    expect(
      buildComponentPreviewUrl("http://127.0.0.1:4321/", "src/layouts/Main.astro"),
    ).toBeNull();
  });
});

describe("componentPreviewReadyScript", () => {
  it("stamps the requested id and harness version", () => {
    const script = componentPreviewReadyScript(
      "src/components/Hero.astro",
      COMPONENT_THUMB_VERSION,
    );
    expect(script).toContain(JSON.stringify("src/components/Hero.astro"));
    expect(script).toContain(JSON.stringify(String(COMPONENT_THUMB_VERSION)));
    expect(script).toContain("data-aria-component-thumb-version");
    expect(script).toContain('return "ok"');
  });
});
