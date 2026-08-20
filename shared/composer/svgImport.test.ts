// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { serializeAstro } from "./serializeAstro";
import { parseSanitizedSvg } from "./svgImport";

function sourceFor(svg: string): string {
  const result = parseSanitizedSvg(svg);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return serializeAstro({
    imports: [], extraFrontmatter: "", nodes: [result.node], propSchema: [], slots: [], extendsTag: null,
  });
}

describe("Composer SVG import sanitization", () => {
  it("removes executable markup and unsafe external references", () => {
    const output = sourceFor('<svg onload="alert(1)"><script>alert(1)</script><foreignObject><iframe /></foreignObject><use href="https://evil.example/x.svg#x" /><path style="fill:url(https://evil.example/x)" fill="url(https://evil.example/x)" /></svg>');
    expect(output).not.toMatch(/script|foreignObject|iframe|onload|evil\.example/i);
  });

  it("preserves safe SVG structure and local fragment references", () => {
    const output = sourceFor('<svg viewBox="0 0 10 10" aria-label="Mark"><defs><linearGradient id="g" /></defs><path fill="url(#g)" d="M0 0h10v10z" /><use href="#g" /></svg>');
    expect(output).toContain('viewBox="0 0 10 10"');
    expect(output).toContain("<linearGradient");
    expect(output).toContain('fill="url(#g)"');
    expect(output).toContain('href="#g"');
  });

  it("rejects non-SVG input", () => {
    expect(parseSanitizedSvg("<div>Not SVG</div>")).toMatchObject({ ok: false });
  });
});
