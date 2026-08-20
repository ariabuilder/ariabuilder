import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { writeComposerComponentControlMetadata } from "./componentControlMetadata";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aria-condition-controls-"));
  roots.push(root);
  const directory = path.join(root, "src", "components");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "Card.astro");
  writeFileSync(file, `---\ninterface Props { plan?: string; icon?: string }\n---\n<article />\n`);
  return { root, file, relativeFile: "src/components/Card.astro" };
}

describe("component control metadata writes", () => {
  it("writes validated static metadata with an optimistic revision", () => {
    const { root, file, relativeFile } = fixture();
    const mtimeMs = Math.floor(statSync(file).mtimeMs);
    const result = writeComposerComponentControlMetadata({
      projectPath: root,
      relativeFile,
      expectedMtimeMs: mtimeMs,
      metadata: {
        version: 1,
        fields: {
          icon: {
            visibleWhen: {
              version: 1,
              groups: [{
                id: "plan-group",
                rules: [{
                  id: "plan-rule",
                  source: { provider: "component", path: ["plan"] },
                  operator: "equals",
                  value: "pro",
                }],
              }],
            },
          },
        },
      },
    });
    expect(result).toMatchObject({ ok: true, relativeFile });
    expect(readFileSync(file, "utf8")).toContain("@aria-component-controls v1");
  });

  it("refuses stale writes without changing the component", () => {
    const { root, file, relativeFile } = fixture();
    const before = readFileSync(file, "utf8");
    expect(() => writeComposerComponentControlMetadata({
      projectPath: root,
      relativeFile,
      expectedMtimeMs: 0,
      metadata: { version: 1, fields: {} },
    })).toThrow("changed on disk");
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

