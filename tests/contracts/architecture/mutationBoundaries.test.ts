import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MUTATION_OWNERS = [
  "electron/cms/contentSync.ts",
  "electron/cms/store.ts",
  "electron/composer/motionAssets.ts",
  "electron/composer/transaction.ts",
  "electron/design/index.ts",
  "electron/discoveryInjection.ts",
  "electron/media.ts",
  "electron/mediaTransforms.ts",
  "electron/redirectsInjection.ts",
  "electron/seoSync.ts",
  "electron/seoTakeover.ts",
  "electron/siteSettings.ts",
  "electron/workspace.ts",
] as const;

describe("project mutation filesystem boundaries", () => {
  it("keeps mutation-owned modules behind tracked filesystem helpers", () => {
    const violations: string[] = [];
    for (const relative of MUTATION_OWNERS) {
      const source = fs.readFileSync(path.resolve(relative), "utf8");
      if (
        /\b(?:writeFileSync|rmSync|unlinkSync|renameSync|copyFileSync|linkSync)\s*\(/.test(
          source,
        )
      ) {
        violations.push(relative);
      }
    }
    expect(violations).toEqual([]);
  });
});
