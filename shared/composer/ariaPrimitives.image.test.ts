import { describe, expect, it } from "vitest";
import {
  COMPOSER_IMAGE_PLACEHOLDER_SRC,
  createAriaPrimitiveNode,
} from "./ariaPrimitives";
import { serializeAstro } from "./serializeAstro";

describe("image primitive", () => {
  it("uses a portable placeholder instead of requiring a project file", () => {
    const image = createAriaPrimitiveNode("image");

    expect(image.kind).toBe("element");
    if (image.kind !== "element") return;
    expect(image.props.src).toEqual({
      type: "string",
      value: COMPOSER_IMAGE_PLACEHOLDER_SRC,
    });
    expect(COMPOSER_IMAGE_PLACEHOLDER_SRC).toMatch(/^data:image\/svg\+xml,/);
    expect(COMPOSER_IMAGE_PLACEHOLDER_SRC).not.toContain("placeholder.svg");
    const svg = decodeURIComponent(COMPOSER_IMAGE_PLACEHOLDER_SRC.slice("data:image/svg+xml,".length));
    expect(svg).toContain(".surface{fill:oklch(0.94 0 0)}");
    expect(svg).toContain(".mountain{stroke:oklch(0.38 0.016 145.14 / .4)}");
    expect(svg).toContain("@media (prefers-color-scheme:dark)");
    expect(svg).toContain(".surface{fill:oklch(0.269 0 0)}");
    expect(svg).toContain(".mountain{stroke:oklch(0.8 0 0 / .4)}");
    expect(svg).toContain('viewBox="0 0 720 360"');
    expect(svg.match(/<path\b/g)).toHaveLength(1);
    expect(svg).not.toContain("<circle");
    expect(svg).not.toContain("<g");
    expect(svg).not.toContain("<defs");

    const source = serializeAstro({
      imports: [],
      extraFrontmatter: "",
      nodes: [image],
      propSchema: [],
      slots: [],
      extendsTag: null,
    });
    expect(source).toContain(COMPOSER_IMAGE_PLACEHOLDER_SRC);
  });
});
