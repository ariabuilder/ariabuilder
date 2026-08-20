import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractComposerPropSchema,
  resolveAstroImport,
} from "./extractPropSchema";

const roots: string[] = [];

function project() {
  const root = mkdtempSync(path.join(tmpdir(), "aria-component-resolve-"));
  roots.push(root);
  mkdirSync(path.join(root, "src/pages"), { recursive: true });
  mkdirSync(path.join(root, "src/components/cards"), { recursive: true });
  writeFileSync(path.join(root, "src/pages/index.astro"), "---\n---\n");
  writeFileSync(
    path.join(root, "src/components/Card.astro"),
    "---\n---\n<div />\n",
  );
  writeFileSync(
    path.join(root, "src/components/cards/index.astro"),
    "---\n---\n<div />\n",
  );
  writeFileSync(path.join(root, "root-component.astro"), "---\n---\n<div />\n");
  writeFileSync(
    path.join(root, "src/components/not-astro.ts"),
    "export default {}\n",
  );
  return { root, from: path.join(root, "src/pages/index.astro") };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("resolveAstroImport", () => {
  it("extracts static component-control conditions without executing the component", () => {
    const { root } = project();
    writeFileSync(
      path.join(root, "src/components/Card.astro"),
      `---
interface Props {
  plan?: "free" | "pro"
  badge?: string
}
/* @aria-component-controls v1
{
  "version": 1,
  "fields": {
    "badge": {
      "visibleWhen": {
        "version": 1,
        "groups": [{
          "id": "g",
          "rules": [{
            "id": "r",
            "source": { "provider": "component", "path": ["plan"] },
            "operator": "equals",
            "value": "pro"
          }]
        }]
      }
    }
  }
}
*/
---
<div>{Astro.props.badge}</div>
`,
    );
    const result = extractComposerPropSchema({
      projectPath: root,
      fromRelativeFile: "src/pages/index.astro",
      importSpec: "../components/Card.astro",
    });
    expect(result).toMatchObject({
      resolved: true,
      controlMetadataFound: true,
      controlMetadataValid: true,
    });
    expect(result.fields.find((field) => field.name === "badge")?.visibleWhen?.groups[0]?.rules[0]).toMatchObject({
      source: { provider: "component", path: ["plan"] },
      operator: "equals",
      value: "pro",
    });
  });

  it.skipIf(!process.env.ARIA_COMPONENT_RESOLVE_PROJECT)(
    "resolves the configured component alias in a real Astro project",
    () => {
      const root = process.env.ARIA_COMPONENT_RESOLVE_PROJECT!;
      expect(
        resolveAstroImport(
          root,
          path.join(root, "src/pages/index.astro"),
          "@components/Sections/Home/Hero.astro",
        ),
      ).toBe(path.join(root, "src/components/Sections/Home/Hero.astro"));
    },
  );

  it("resolves relative, extensionless, @/, ~/, and index imports", () => {
    const { root, from } = project();
    expect(resolveAstroImport(root, from, "../components/Card.astro")).toBe(
      path.join(root, "src/components/Card.astro"),
    );
    expect(resolveAstroImport(root, from, "../components/Card")).toBe(
      path.join(root, "src/components/Card.astro"),
    );
    expect(resolveAstroImport(root, from, "@/components/Card")).toBe(
      path.join(root, "src/components/Card.astro"),
    );
    expect(resolveAstroImport(root, from, "~/root-component")).toBe(
      path.join(root, "root-component.astro"),
    );
    expect(resolveAstroImport(root, from, "../components/cards")).toBe(
      path.join(root, "src/components/cards/index.astro"),
    );
  });

  it("leaves packages, missing files, and paths outside the project opaque", () => {
    const { root, from } = project();
    expect(resolveAstroImport(root, from, "some-package")).toBeNull();
    expect(resolveAstroImport(root, from, "../components/Missing")).toBeNull();
    expect(
      resolveAstroImport(root, from, "../../../../outside.astro"),
    ).toBeNull();
  });

  it("resolves JSONC tsconfig path arrays without baseUrl to the exact duplicate-named Astro file", () => {
    const { root, from } = project();
    mkdirSync(path.join(root, "src/components/Sections/Home"), {
      recursive: true,
    });
    mkdirSync(path.join(root, "src/components/Sections/About"), {
      recursive: true,
    });
    writeFileSync(
      path.join(root, "src/components/Sections/Home/Hero.astro"),
      "---\ninterface Props { heading: string }\n---\n<h1>{Astro.props.heading}</h1>\n",
    );
    writeFileSync(
      path.join(root, "src/components/Sections/About/Hero.astro"),
      "---\n---\n<section>About</section>\n",
    );
    writeFileSync(
      path.join(root, "tsconfig.json"),
      `{
        // Astro projects commonly omit baseUrl.
        "compilerOptions": {
          "paths": {
            "@components/*": ["./missing/*", "./src/components/*"]
          }
        }
      }`,
    );

    const expected = path.join(root, "src/components/Sections/Home/Hero.astro");
    expect(
      resolveAstroImport(root, from, "@components/Sections/Home/Hero.astro"),
    ).toBe(expected);
    expect(
      resolveAstroImport(root, from, "@components/Sections/Home/Hero"),
    ).toBe(expected);
    expect(
      extractComposerPropSchema({
        projectPath: root,
        fromRelativeFile: "src/pages/index.astro",
        importSpec: "@components/Sections/Home/Hero.astro",
      }),
    ).toMatchObject({
      resolved: true,
      relativeFile: "src/components/Sections/Home/Hero.astro",
    });
  });

  it("resolves inherited exact, wildcard, and index Astro path mappings", () => {
    const { root, from } = project();
    mkdirSync(path.join(root, "configs"), { recursive: true });
    mkdirSync(path.join(root, "src/components/Sections/Home"), {
      recursive: true,
    });
    mkdirSync(path.join(root, "src/components/widgets"), { recursive: true });
    writeFileSync(
      path.join(root, "src/components/Sections/Home/Hero.astro"),
      "---\n---\n<section>Home</section>\n",
    );
    writeFileSync(
      path.join(root, "src/components/widgets/index.astro"),
      "---\n---\n<div>Widget</div>\n",
    );
    writeFileSync(
      path.join(root, "configs/aliases.json"),
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@home-hero": ["../src/components/Sections/Home/Hero.astro"],
            "@widgets/*": ["../src/components/widgets/*"],
          },
        },
      }),
    );
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ extends: "./configs/aliases.json" }),
    );

    expect(resolveAstroImport(root, from, "@home-hero")).toBe(
      path.join(root, "src/components/Sections/Home/Hero.astro"),
    );
    expect(resolveAstroImport(root, from, "@widgets/")).toBe(
      path.join(root, "src/components/widgets/index.astro"),
    );
  });

  it("rejects tsconfig path targets outside the project", () => {
    const { root, from } = project();
    const outside = mkdtempSync(path.join(tmpdir(), "aria-outside-component-"));
    roots.push(outside);
    writeFileSync(path.join(outside, "Hero.astro"), "---\n---\n<div />\n");
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          paths: {
            "@outside/*": [`../${path.basename(outside)}/*`],
          },
        },
      }),
    );

    expect(resolveAstroImport(root, from, "@outside/Hero.astro")).toBeNull();
  });
});
